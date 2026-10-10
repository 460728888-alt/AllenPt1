import {originalScaleComparable} from './data-contract.js';
import crypto from 'node:crypto';
import {SCREEN_STRATEGY,PRICE_VERSION} from './price-levels.js';
export function canonicalJson(value) {
  if (Array.isArray(value)) return '['+value.map(canonicalJson).join(',')+']';
  if (value&&typeof value==='object') return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonicalJson(value[k])).join(',')+'}';
  return JSON.stringify(value??null);
}
export const snapshotHash=value=>crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const ended=s=>['invalidated','closed','expired','逻辑失效','完成复盘'].includes(s);
const unavailable=message=>Object.assign(new Error(message),{code:'storage_unavailable',status:503});

export function createResearchStore(pool,{enabled=false}={}) {
  async function ready(client=pool,{write=false}={}) {
    if(!pool)throw unavailable('原始研究存储未启用');
    if(write&&!enabled)throw unavailable('原始研究保存功能未启用');
    const r=await client.query("SELECT to_regclass('research_opportunities') AS a,to_regclass('research_events') AS b,to_regclass('research_episode_heads') AS c");
    if(!r.rows[0]?.a||!r.rows[0]?.b||!r.rows[0]?.c)throw unavailable('原始研究存储结构尚未准备，保存功能未启用');
  }
  async function transaction(fn) {
    await ready(pool,{write:true});
    const c=await pool.connect();
    try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}
    catch(error){await c.query('ROLLBACK').catch(()=>{});throw error}finally{c.release()}
  }
  async function record(c,userId,{symbol,channel,strategyVersion,scanId,snapshot,canCreate=true}) {
    const key=`${channel}:${strategyVersion}:${symbol}:${scanId}`;
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${userId}:${symbol}:${channel}:${strategyVersion}`]);
    const duplicate=(await c.query('SELECT research_id FROM research_events WHERE user_id=$1 AND request_key=$2',[userId,key])).rows[0];
    if(duplicate)return duplicate.research_id;
    const head=(await c.query(`SELECT o.* FROM research_episode_heads h JOIN research_opportunities o ON o.id=h.research_id AND o.user_id=h.user_id
      WHERE h.user_id=$1 AND h.symbol=$2 AND h.channel=$3 AND h.strategy_version=$4 FOR UPDATE OF h`,[userId,symbol,channel,strategyVersion])).rows[0];
    const last=head?(await c.query('SELECT *,data_through::text AS data_through FROM research_events WHERE user_id=$1 AND research_id=$2 ORDER BY sequence DESC LIMIT 1',[userId,head.id])).rows[0]:null;
    let id=head?.id,status=last?.payload?.status||'tracking',kind='refreshed';
    const cutoff=snapshot.dataThrough;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(cutoff||''))throw Error('原始研究缺少数据截止日期');
    // PostgreSQL DATE is a calendar date, not a local-midnight JS timestamp.
    const previousCutoff=last?.data_through||null;
    if(previousCutoff&&cutoff<previousCutoff)return id; // Delayed request cannot move an episode backwards.
    if(!head||ended(status)) {
      if(!canCreate||snapshot.data?.state!=='ok'||(previousCutoff&&cutoff<=previousCutoff))return id||null;
      id=crypto.randomUUID();status='tracking';kind='created';
      const frozen=JSON.parse(JSON.stringify(snapshot));
      await c.query(`INSERT INTO research_opportunities(id,user_id,symbol,channel,strategy_version,calculation_version,source_scan_id,data_through,snapshot,snapshot_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,userId,symbol,channel,strategyVersion,PRICE_VERSION,scanId,cutoff,JSON.stringify(frozen),snapshotHash(frozen)]);
      await c.query(`INSERT INTO research_episode_heads(user_id,symbol,channel,strategy_version,research_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id,symbol,channel,strategy_version) DO UPDATE SET research_id=EXCLUDED.research_id`,[userId,symbol,channel,strategyVersion,id]);
    } else if(snapshot.data?.state!=='ok'||(channel==='volume'&&!originalScaleComparable(head.snapshot,snapshot)))kind='data_gap';
    else if(channel==='volume'&&Number.isFinite(snapshot.price)&&Number.isFinite(head.snapshot?.levels?.stop)&&snapshot.price<=head.snapshot.levels.stop) {
      status='invalidated';kind='invalidated';
    }
    if(channel==='radar'&&kind!=='created'&&head?.snapshot?.originalWindow?.end<cutoff){status='expired';kind='invalidated'}
    await c.query(`INSERT INTO research_events(id,user_id,research_id,request_key,kind,data_through,payload) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(),userId,id,key,kind,cutoff,JSON.stringify({status,snapshot,originalStop:kind==='created'?(snapshot.levels?.stop??null):(head?.snapshot?.levels?.stop??null)})]);
    return id;
  }
  async function saveVolumeScan(userId,input) {
    const result=JSON.parse(JSON.stringify(input));
    return transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`scan:${userId}:${result.id}`]);
      const existing=(await c.query('SELECT result_json FROM volume_screen_runs WHERE id=$1 AND user_id=$2',[result.id,userId])).rows[0];
      if(existing)return existing.result_json;
      const bySymbol=new Map(result.items.map(i=>[i.symbol,i]));
      for(const snapshot of [...result.observations].sort((a,b)=>a.symbol.localeCompare(b.symbol))) {
        const id=await record(c,userId,{symbol:snapshot.symbol,channel:'volume',strategyVersion:SCREEN_STRATEGY.version,scanId:result.id,snapshot,canCreate:bySymbol.has(snapshot.symbol)&&!snapshot.originalInvalid});
        if(id&&bySymbol.has(snapshot.symbol)) {
          const item=bySymbol.get(snapshot.symbol);
          const original=(await c.query('SELECT snapshot,snapshot_hash FROM research_opportunities WHERE user_id=$1 AND id=$2',[userId,id])).rows[0];
          Object.assign(item,{researchId:id,original:original.snapshot,snapshotHash:original.snapshot_hash,giveUpPrice:original.snapshot.levels?.stop??item.giveUpPrice});
          if(originalScaleComparable(original.snapshot,item)&&item.price<=original.snapshot.levels?.stop)Object.assign(item,{tone:'red',status:'🔴 原始结构已失效',reason:'收盘触及原始快照失效价，不等待放量'});
        }
      }
      const saved={...result,storage:{state:'saved',durable:true}};
      await c.query('INSERT INTO volume_screen_runs(id,user_id,result_json) VALUES($1,$2,$3)',[result.id,userId,JSON.stringify(saved)]);
      return saved;
    });
  }
  async function list(userId,{channel=null}={}) {
    await ready();
    const r=await pool.query(`SELECT o.*,e.payload AS latest,e.kind AS latest_kind FROM research_opportunities o
      LEFT JOIN LATERAL (SELECT payload,kind FROM research_events WHERE user_id=o.user_id AND research_id=o.id ORDER BY sequence DESC LIMIT 1) e ON TRUE
      WHERE o.user_id=$1 AND ($2::text IS NULL OR o.channel=$2) ORDER BY o.created_at DESC LIMIT 200`,[userId,channel]);
    return r.rows.map(o=>({researchId:o.id,symbol:o.symbol,original:o.snapshot,snapshotHash:o.snapshot_hash,latest:o.latest,
      firstSeenAt:o.created_at,strategyVersion:o.strategy_version,channel:o.channel,name:o.snapshot.name,status:o.latest?.status||'tracking',legacy:false}));
  }
  async function get(userId,id) {
    await ready();
    const original=(await pool.query('SELECT * FROM research_opportunities WHERE user_id=$1 AND id=$2',[userId,id])).rows[0];
    if(!original)return null;
    const events=(await pool.query('SELECT *,data_through::text AS data_through FROM research_events WHERE user_id=$1 AND research_id=$2 ORDER BY sequence',[userId,id])).rows;
    return {researchId:id,original:original.snapshot,snapshotHash:original.snapshot_hash,events};
  }
  async function note(userId,id,{requestKey,note,status}) {
    if(!requestKey||typeof note!=='string'||!note.trim())throw Object.assign(new Error('需要请求编号和复核内容'),{status:400});
    return transaction(async c=>{
      const original=(await c.query('SELECT *,data_through::text AS data_through FROM research_opportunities WHERE user_id=$1 AND id=$2',[userId,id])).rows[0];
      if(!original)throw Object.assign(new Error('研究记录不存在'),{status:404});
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${userId}:${original.symbol}:${original.channel}:${original.strategy_version}`]);
      const last=(await c.query('SELECT payload,data_through::text AS data_through FROM research_events WHERE user_id=$1 AND research_id=$2 ORDER BY sequence DESC LIMIT 1',[userId,id])).rows[0];
      if(status&&!['tracking','review','closed','invalidated'].includes(status))throw Object.assign(new Error('未知研究状态'),{status:400});
      if(ended(last?.payload?.status)&&status&&!ended(status))throw Object.assign(new Error('已结束研究不可重新开启；新机会须新建编号'),{status:400});
      await c.query(`INSERT INTO research_events(id,user_id,research_id,request_key,kind,data_through,payload) VALUES($1,$2,$3,$4,'note',$5,$6) ON CONFLICT(user_id,request_key) DO NOTHING`,
        [crypto.randomUUID(),userId,id,`note:${id}:${requestKey}`,last?.data_through||original.data_through,JSON.stringify({...last?.payload,status:status||last?.payload?.status||'tracking',note:note.trim().slice(0,1000)})]);
      return {ok:true};
    });
  }
  async function saveRadar(userId,input) {
    const report=JSON.parse(JSON.stringify(input));
    await transaction(async c=>{
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`scan:${userId}:${report.id}`]);
      for(const idea of [...report.candidates].sort((a,b)=>a.symbol.localeCompare(b.symbol))) {
        if(!idea.data?.dataThrough||!report.scanCandidates?.some(i=>i.symbol===idea.symbol))continue;
        idea.researchId=await record(c,userId,{symbol:idea.symbol,channel:'radar',strategyVersion:'event-evidence-1',scanId:report.id,
          snapshot:{...idea,dataThrough:idea.data.dataThrough,originalWindow:report.window},canCreate:idea.data.state==='ok'});
      }
      await c.query('INSERT INTO opportunity_reports(id,user_id,result_json) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[report.id,userId,JSON.stringify({...report,storage:{state:'saved',durable:true}})]);
    });
    Object.assign(input,report);
  }
  return {ready,list,get,note,saveVolumeScan,saveRadar};
}
