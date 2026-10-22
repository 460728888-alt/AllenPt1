import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {createResearchStore,snapshotHash} from '../research-store.js';

// 全部为合成测试数据，不使用真实行情或生产数据库。
if (process.env.DATABASE_URL) {
  throw Error('Refusing to run with DATABASE_URL set');
}
const raw=process.env.TEST_DATABASE_URL;
if (!raw) throw Error('TEST_DATABASE_URL is required');
const url=new URL(raw);
if (
  !['postgres:','postgresql:'].includes(url.protocol) ||
  !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
  !/^\/allen_test_[a-z0-9_]+$/.test(url.pathname) ||
  url.search
) throw Error('Only an explicit local allen_test_* database is allowed');

const schema=process.env.TEST_RESEARCH_SCHEMA ||
  'allen_test_'+crypto.randomBytes(10).toString('hex');
if (!/^allen_test_[a-f0-9]{20}$/.test(schema)) {
  throw Error('Invalid isolated test schema');
}
const makePool=(options={})=>new pg.Pool({
  connectionString:raw,
  options:'-c search_path='+schema+',pg_catalog',
  connectionTimeoutMillis:3000,
  query_timeout:10000,
  max:5,
  ...options
});

function observation(symbol='600001.SS',date='2026-10-12',extra={}) {
  return {
    symbol,name:'synthetic-test-only',
    generatedAt:'2026-10-12T08:00:00Z',
    dataThrough:date,
    data:{
      state:'ok',dataThrough:date,historyStart:'2026-01-01'
    },
    price:11.5,
    levels:{stop:10,entry:12,target1:13,target2:14},
    evidence:{source:'synthetic-test-only',volumePresent:true},
    ...extra
  };
}

function scan(snapshots) {
  return {
    id:crypto.randomUUID(),createdAt:new Date().toISOString(),
    observations:snapshots,
    items:snapshots.map(s=>({...s,tone:'yellow'}))
  };
}

function worker(mode,id='') {
  return JSON.parse(execFileSync(
    process.execPath,[fileURLToPath(import.meta.url),mode,id],
    {
      encoding:'utf8',timeout:30000,
      env:{
        PATH:process.env.PATH,
        NODE_ENV:'test',
        DATABASE_URL:'',
        TEST_DATABASE_URL:raw,
        TEST_RESEARCH_SCHEMA:schema,
        TZ:process.env.TZ||'UTC'
      }
    }
  ));
}

if (process.argv[2]?.startsWith('worker-')) {
  if (!process.env.TEST_RESEARCH_SCHEMA) {
    throw Error('Worker requires the parent isolated schema');
  }
  const pool=makePool();
  try {
    const store=createResearchStore(pool,{enabled:true});
    let id=process.argv[3];
    if (process.argv[2]==='worker-write') {
      const saved=await store.saveVolumeScan(
        1,scan([observation('600099.SS')])
      );
      id=saved.items[0].researchId;
    }
    if (!id) throw Error('Missing research id');
    process.stdout.write(JSON.stringify(await store.get(1,id)));
  } finally {
    await pool.end();
  }
} else {
  await test('isolated PostgreSQL research persistence', {
    timeout:120000
  },async t=>{
    const admin=new pg.Pool({
      connectionString:raw,connectionTimeoutMillis:3000,max:1
    });
    let pool,created=false;
    try {
      console.log('PostgreSQL:',(await admin.query(
        'SELECT version() AS version'
      )).rows[0].version);
      await admin.query('CREATE SCHEMA '+schema);
      created=true;
      pool=makePool();

      // 旧表仅建立最小测试夹具，不读取或复制生产数据。
      await pool.query(
        'CREATE TABLE users(id BIGINT PRIMARY KEY);'+
        'INSERT INTO users VALUES(1),(2);'+
        'CREATE TABLE volume_screen_runs('+
        'id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),'+
        'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
        'result_json JSONB NOT NULL);'+
        'CREATE TABLE opportunity_reports('+
        'id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),'+
        'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
        'result_json JSONB NOT NULL)'
      );
      const client=await pool.connect();
      try {
        await client.query(fs.readFileSync(new URL(
          '../migrations/001_research_history.sql',import.meta.url
        ),'utf8'));
      } catch(error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const store=createResearchStore(pool,{enabled:true});
      let firstId,first;

      await t.test('refresh appends events and preserves original snapshot',async()=>{
        const input=scan([observation()]);
        const saved=await store.saveVolumeScan(1,input);
        firstId=saved.items[0].researchId;
        first=await store.get(1,firstId);
        assert.ok(firstId);
        assert.equal(first.snapshotHash,snapshotHash(first.original));
        const newer=observation('600001.SS','2026-10-13',{
          levels:{stop:9,entry:12.5,target1:14,target2:15}
        });
        await store.saveVolumeScan(1,scan([newer]));
        const after=await store.get(1,firstId);
        assert.deepEqual(after.original,first.original);
        assert.equal(after.snapshotHash,first.snapshotHash);
        assert.equal(after.events.length,2);
        assert.equal(after.events[1].payload.snapshot.levels.stop,9);
        assert.equal(after.events[1].payload.originalStop,10);
      });

      await t.test('parallel retries do not duplicate snapshots or events',async()=>{
        const input=scan([observation('600002.SS')]);
        const results=await Promise.all(Array.from(
          {length:4},()=>store.saveVolumeScan(1,input)
        ));
        const ids=results.map(r=>r.items[0].researchId);
        assert.ok(ids.every(id=>id===ids[0]));
        assert.equal((await store.get(1,ids[0])).events.length,1);
      });

      await t.test('missing data cannot invalidate the original hypothesis',async()=>{
        await store.saveVolumeScan(1,scan([
          observation('600001.SS','2026-10-14',{
            price:8,data:{state:'insufficient'}
          })
        ]));
        const after=await store.get(1,firstId);
        assert.equal(after.events.at(-1).kind,'data_gap');
        assert.equal(after.events.at(-1).payload.status,'tracking');
      });

      await t.test('original close threshold ends the old episode; later opportunity gets a new id',async()=>{
        await store.saveVolumeScan(1,scan([
          observation('600001.SS','2026-10-15',{price:10})
        ]));
        const ended=await store.get(1,firstId);
        assert.equal(ended.events.at(-1).payload.status,'invalidated');
        const saved=await store.saveVolumeScan(1,scan([
          observation('600001.SS','2026-10-16',{
            levels:{stop:9.5,entry:12,target1:13,target2:14}
          })
        ]));
        const newId=saved.items[0].researchId;
        assert.notEqual(newId,firstId);
        assert.deepEqual((await store.get(1,firstId)).original,first.original);
        assert.equal((await store.get(1,newId)).original.levels.stop,9.5);
        assert.equal((await store.list(1)).filter(
          r=>r.symbol==='600001.SS'
        ).length,2);
      });

      await t.test('event radar retains original window and gives a later opportunity a new id',async()=>{
        const report=(date,end)=>({
          id:crypto.randomUUID(),window:{start:date,end},
          candidates:[observation('600005.SS',date)],
          scanCandidates:[{symbol:'600005.SS'}]
        });
        const initial=report('2026-10-12','2026-10-14');
        await store.saveRadar(1,initial);
        const id=initial.candidates[0].researchId;
        const original=(await store.get(1,id)).original;
        const rolling=report('2026-10-15','2026-11-15');
        await store.saveRadar(1,rolling);
        const expired=await store.get(1,id);
        assert.deepEqual(expired.original,original);
        assert.equal(expired.events.at(-1).payload.status,'expired');
        const later=report('2026-10-16','2026-11-16');
        await store.saveRadar(1,later);
        assert.notEqual(later.candidates[0].researchId,id);
        assert.deepEqual((await store.get(1,id)).original,original);
      });

      await t.test('notes are append-only and repeated requests are idempotent',async()=>{
        const input=scan([observation('600003.SS')]);
        const id=(await store.saveVolumeScan(1,input)).items[0].researchId;
        const note={requestKey:'same-note',note:'synthetic review'};
        await store.note(1,id,note);
        await store.note(1,id,note);
        const record=await store.get(1,id);
        assert.equal(record.events.filter(e=>e.kind==='note').length,1);
        assert.equal(record.snapshotHash,snapshotHash(record.original));
      });

      await t.test('another user cannot read or annotate these records',async()=>{
        assert.equal(await store.get(2,firstId),null);
        assert.deepEqual(await store.list(2),[]);
        await assert.rejects(store.note(2,firstId,{
          requestKey:'other-user',note:'must fail'
        }),{status:404});
      });

      await t.test('SQL updates, deletes and truncation of history are rejected',async()=>{
        for (const table of ['research_opportunities','research_events']) {
          for (const statement of [
            'UPDATE '+table+' SET id=id',
            'DELETE FROM '+table,
            'TRUNCATE '+table+' CASCADE'
          ]) {
            await assert.rejects(pool.query(statement),{code:'55000'});
          }
        }
        assert.deepEqual((await store.get(1,firstId)).original,first.original);
      });

      await t.test('a failed scan rolls back snapshots, events, heads and report',async()=>{
        const counts=async()=>(
          await pool.query(
            "SELECT (SELECT count(*) FROM research_opportunities) AS originals,"+
            "(SELECT count(*) FROM research_events) AS events,"+
            "(SELECT count(*) FROM research_episode_heads) AS heads,"+
            "(SELECT count(*) FROM volume_screen_runs) AS runs"
          )
        ).rows[0];
        const before=await counts();
        const bad=observation('999999.SS');
        delete bad.dataThrough;
        await assert.rejects(store.saveVolumeScan(1,scan([
          observation('600004.SS'),bad
        ])),/数据截止/);
        assert.deepEqual(await counts(),before);
      });

      await t.test('a writer exits; a fresh process reads identical persisted history',()=>{
        const written=worker('worker-write');
        const read=worker('worker-read',written.researchId);
        assert.ok(written.researchId);
        assert.equal(written.events.length,1);
        assert.deepEqual(read,written);
      });

      await t.test('missing tables return an explicit storage error',async()=>{
        const missing=makePool({options:'-c search_path=pg_catalog'});
        try {
          await assert.rejects(
            createResearchStore(missing,{enabled:true}).list(1),
            {code:'storage_unavailable',status:503}
          );
        } finally {
          await missing.end();
        }
      });

      await t.test('an unavailable database connection rejects reads and writes',async()=>{
        const probe=net.createServer();
        await new Promise((resolve,reject)=>{
          probe.once('error',reject);
          probe.listen(0,'127.0.0.1',resolve);
        });
        const port=probe.address().port;
        await new Promise((resolve,reject)=>{
          probe.close(error=>error?reject(error):resolve());
        });
        const badUrl=new URL(raw);
        badUrl.hostname='127.0.0.1';
        badUrl.port=String(port);
        const broken=makePool({
          connectionString:badUrl.href,connectionTimeoutMillis:1000
        });
        try {
          const unavailable=createResearchStore(broken,{enabled:true});
          await assert.rejects(unavailable.list(1),{code:'ECONNREFUSED'});
          await assert.rejects(
            unavailable.saveVolumeScan(1,scan([observation()])),
            {code:'ECONNREFUSED'}
          );
        } finally {
          await broken.end();
        }
      });
    } finally {
      if (pool) await pool.end();
      try {
        if (created) await admin.query('DROP SCHEMA '+schema+' CASCADE');
      } finally {
        await admin.end();
      }
    }
  });
}
