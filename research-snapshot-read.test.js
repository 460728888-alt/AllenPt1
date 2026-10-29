import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchStore,snapshotHash} from './research-store.js';
function poolFor(row){
  return {async query(sql){
    if(sql.includes('to_regclass'))return {rows:[{a:'research_opportunities',b:'research_events',c:'research_episode_heads'}]};
    if(sql.includes('FROM research_opportunities'))return {rows:[row]};
    if(sql.includes('FROM research_events'))return {rows:[]};
    throw Error('Unexpected SQL in read-only fixture');
  }};
}
test('a corrupted original hash blocks replay with an explicit storage error',async()=>{
  const store=createResearchStore(poolFor({snapshot:{price:10},snapshot_hash:'wrong'}));
  await assert.rejects(store.get(1,'synthetic'),{code:'storage_unavailable',status:503});
});
test('verified original response exposes saved metadata without writing to storage',async()=>{
  const snapshot={symbol:'SYNTHETIC',price:10},hash=snapshotHash(snapshot);
  const row={snapshot,snapshot_hash:hash,created_at:'2026-10-12T08:00:00Z',
    data_through:'2026-10-12',strategy_version:'synthetic-strategy',
    calculation_version:'range20-1',source_scan_id:'synthetic-scan'};
  const result=await createResearchStore(poolFor(row)).get(1,'synthetic');
  assert.equal(result.snapshotVerified,true);assert.equal(result.generatedAt,row.created_at);
  assert.equal(result.strategyVersion,'synthetic-strategy');
  assert.equal(result.dataThrough,'2026-10-12');assert.deepEqual(result.original,snapshot);
});
