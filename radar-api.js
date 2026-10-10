import crypto from 'node:crypto';
import {buildRadar,validateCriteria} from './radar-engine.js';
import {mapLimit} from './opportunity.js';
import {mergeOpportunityLifecycle} from './radar-lifecycle.js';

export async function initRadarTables(pool){if(!pool)return;await pool.query(`CREATE TABLE IF NOT EXISTS radar_journal (
 id TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 report_id TEXT NOT NULL,symbol TEXT NOT NULL,data_json JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,report_id,symbol))`);
 await pool.query(`CREATE TABLE IF NOT EXISTS radar_lifecycle (
 user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,symbol TEXT NOT NULL,data_json JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,symbol))`);
}
export function registerRadar({app,auth,pool,market,research,quote,publicJson,ai,ranker,researchStore}){
 const jobs=new Map(),reports=[],journal=new Map(),lifecycle=new Map(),bodyCache=new Map(),feedCache=new Map();
 const active=id=>[...jobs.values()].find(j=>j.userId===id&&j.status==='running');
 const readReports=async userId=>pool?(await pool.query('SELECT result_json FROM opportunity_reports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10',[userId])).rows.map(r=>r.result_json):reports.filter(r=>r.userId===userId).slice(-10).reverse().map(r=>r.result);
 const getReport=async(userId,id)=>pool?(await pool.query('SELECT result_json FROM opportunity_reports WHERE user_id=$1 AND id=$2',[userId,id])).rows[0]?.result_json:reports.find(r=>r.userId===userId&&r.result.id===id)?.result;
 const readJournal=async userId=>pool?(await pool.query('SELECT id,data_json FROM radar_journal WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])).rows.map(r=>({id:r.id,...r.data_json})):[...journal.values()].filter(r=>r.userId===userId).map(r=>({id:r.id,...r.data})).reverse();
 const readLifecycle=async userId=>{
   if(!pool)return [];
   if(process.env.RESEARCH_HISTORY_ENABLED==='true'&&researchStore) {
     const entries=await researchStore.list(userId,{channel:'radar'});
     return entries.map((entry,i)=>({symbol:entry.symbol,researchId:entry.researchId,originalIdea:entry.original,idea:{...entry.latest?.snapshot,researchId:entry.researchId},
       status:entry.status==='invalidated'?'逻辑失效':entry.status==='closed'?'完成复盘':entry.status==='expired'?'已到期':'跟踪中',position:i+1,firstSeenAt:entry.firstSeenAt,
       validUntil:entry.original.originalWindow?.end,eventDate:null,seenCount:1}));
   }
   return (await pool.query('SELECT data_json FROM radar_lifecycle WHERE user_id=$1 ORDER BY updated_at,symbol',[userId])).rows.map(r=>({...r.data_json,legacy:true}));
 };
 async function feed(limit){
   const cached=feedCache.get(limit);if(cached&&Date.now()-cached.time<600000)return cached.value;
   const seen=new Map();const pages=await mapLimit(Array.from({length:limit/100},(_,i)=>i+1),3,async page=>{
     const data=await publicJson(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=100&page_index=${page}&ann_type=A&client_source=web`);
     if(!Array.isArray(data?.data?.list))throw Error('公告列表格式异常');return data.data.list;
   });
   for(const page of pages.filter(r=>r.ok))for(const a of page.value)seen.set(a.art_code,a);
   if(!seen.size)throw Error('未取得公告列表');
   const value={items:[...seen.values()],pages:pages.filter(r=>r.ok).length,failedPages:pages.filter(r=>!r.ok).length,failures:pages.filter(r=>!r.ok).map(r=>r.error)};feedCache.set(limit,{time:Date.now(),value});return value;
 }
 async function content(id){
   if(!/^AN\d+$/.test(id))throw Error('公告编号无效');
   const cached=bodyCache.get(id);if(cached)return cached;
   const data=await publicJson(`https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${id}&client_source=web&page_index=1`);
   if(!data?.data?.notice_content)throw Error('公告正文缺失');
   if(data.data.art_code&&data.data.art_code!==id)throw Error('公告正文编号不匹配');
   const value={text:String(data.data.notice_content).slice(0,40000),bodyTruncated:String(data.data.notice_content).length>40000||Number(data.data.page_size)>1,
     pdfLink:/^https:\/\/pdf\.dfcfw\.com\//.test(data.data.attach_url||'')?data.data.attach_url:null,bodyFetchedAt:new Date().toISOString()};
   if(bodyCache.size>=300)bodyCache.delete(bodyCache.keys().next().value);bodyCache.set(id,value);return value;
 }
 const safe=handler=>async(req,res)=>{try{await handler(req,res)}catch(error){res.status(503).json({error:error.message||'数据服务暂不可用'})}};
 app.get('/api/ai/radar-history',auth,safe(async(req,res)=>{if(!pool)throw Error('记录暂不可读取：持久存储未启用');res.json({reports:await readReports(req.user.id),durable:true})}));
 app.get('/api/ai/radar-active',auth,(req,res)=>{const job=active(req.user.id);res.json({jobId:job?.id||null})});
 app.get('/api/ai/radar-jobs/:id',auth,(req,res)=>{
   const job=jobs.get(req.params.id);if(!job||job.userId!==req.user.id)return res.status(404).json({error:'任务不存在或服务器已重启；请先查看历史报告，再重试。'});
   res.json({jobId:job.id,status:job.status,stage:job.stage,completed:job.completed,total:job.total,result:job.result,error:job.error});
 });
 app.post('/api/ai/screen',auth,(req,res)=>{
   let criteria;try{criteria=validateCriteria(req.body)}catch(e){return res.status(400).json({error:e.message})}
   const previous=active(req.user.id);if(previous)return res.status(202).json({jobId:previous.id,reused:true});
   for(const [id,j]of jobs)if(j.status!=='running'&&Date.now()-j.started>1800000)jobs.delete(id);
   if([...jobs.values()].filter(j=>j.status==='running').length>=2)return res.status(429).json({error:'当前已有两项扫描，请稍后重试。'});
   if(jobs.size>=100)return res.status(429).json({error:'任务缓存已满，请稍后重试。'});
   const id=crypto.randomUUID(),job={id,userId:req.user.id,started:Date.now(),status:'running',stage:'准备扫描',completed:0,total:1};jobs.set(id,job);
   res.status(202).json({jobId:id});
   void (async()=>{try{
     const result=await buildRadar(criteria,{market,research,quote,feed,content,ranker,ai:ai?result=>ai(req.user.username,result):null},(stage,completed,total)=>Object.assign(job,{stage,completed,total}));
     Object.assign(result,{id,createdAt:new Date().toISOString(),durable:!!pool});
     result.scanCandidates=result.candidates;
     let previous=[];try{previous=await readLifecycle(req.user.id)}catch(error){result.historyRead={state:'unavailable',reason:error.message}}
     // 首次升级时把最近一份旧报告迁入稳定候选池，避免部署新版当天清空原有观察对象。
     if(!previous.length&&!result.historyRead){
       let prior=null;try{prior=(await readReports(req.user.id))[0]}catch(error){result.historyRead={state:'unavailable',reason:error.message}}
       if(prior?.candidates?.length)previous=mergeOpportunityLifecycle([],prior,new Date(prior.createdAt||result.createdAt)).entries;
     }
     const merged=mergeOpportunityLifecycle(previous,result,new Date(result.createdAt));
     Object.assign(result,{candidates:merged.candidates,newCandidates:merged.newCandidates,continuingCandidates:merged.continuingCandidates,
       lifecycle:{active:merged.candidates.length,new:merged.newCandidates.length,continuing:merged.continuingCandidates.length,expired:merged.expired}});
     try{
       if(!pool||!researchStore)throw Error('原始研究持久存储未启用');
       await researchStore.saveRadar(req.user.id,result);
       result.storage={state:'saved',durable:true};
     }catch(error){result.storage={state:'failed',durable:false,message:'保存失败：'+error.message};result.durable=false}
     Object.assign(job,{status:'done',result,stage:result.storage.durable?'已保存':'研究已完成，保存失败'});
   }catch(error){Object.assign(job,{status:'failed',error:error.message,stage:'扫描未完成'})}})();
 });
 app.get('/api/radar/journal',auth,safe(async(req,res)=>{
   if(!pool)throw Error('研究卡暂不可读取：持久存储未启用');
   const items=await readJournal(req.user.id);
   for(const j of items){j.legacy=!j.researchId;if(j.researchId&&researchStore){const record=await researchStore.get(req.user.id,j.researchId);if(record){j.notes=[...j.notes,...record.events.filter(e=>e.kind==='note').map(e=>({at:e.occurred_at,note:e.payload.note,status:e.payload.status}))];j.status=record.events.at(-1)?.payload?.status||j.status}}}
   res.json({items,durable:true});
 }));
 app.post('/api/radar/journal',auth,safe(async(req,res)=>{
   if(!pool)throw Error('保存失败：持久存储未启用');
   const report=await getReport(req.user.id,String(req.body.reportId||''));const idea=report?.candidates.find(c=>c.symbol===req.body.symbol);
   if(!idea)return res.status(404).json({error:'找不到属于你的这份报告或候选'});
   const existing=(await readJournal(req.user.id)).find(j=>j.reportId===report.id&&j.idea.symbol===idea.symbol);if(existing)return res.json({item:existing});
   if((await readJournal(req.user.id)).length>=100)return res.status(400).json({error:'研究卡已达100张上限'});
   const id=crypto.randomUUID(),data={reportId:report.id,idea,window:report.window,createdAt:new Date().toISOString(),baselinePrice:idea.price,baselineAt:idea.quoteAt||null,
     status:'跟踪中',notes:[],checks:[],researchId:idea.researchId||null,legacy:!idea.researchId};
   if(pool){const saved=await pool.query('INSERT INTO radar_journal(id,user_id,report_id,symbol,data_json) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,report_id,symbol) DO UPDATE SET report_id=radar_journal.report_id RETURNING id,data_json',[id,req.user.id,report.id,idea.symbol,JSON.stringify(data)]);return res.json({item:{id:saved.rows[0].id,...saved.rows[0].data_json}});}
   const duplicate=[...journal.values()].find(j=>j.userId===req.user.id&&j.data.reportId===report.id&&j.data.idea.symbol===idea.symbol);
   if(duplicate)return res.json({item:{id:duplicate.id,...duplicate.data}});
   journal.set(id,{id,userId:req.user.id,data});res.json({item:{id,...data}});
 }));
 app.post('/api/radar/journal/:id/review',auth,safe(async(req,res)=>{
   if(!pool)throw Error('保存失败：持久存储未启用');
   const id=req.params.id;
   // Atomic JSON append prevents simultaneous reviews from overwriting one another.
   const found=(await readJournal(req.user.id)).find(j=>j.id===id);if(!found)return res.status(404).json({error:'研究卡不存在'});
   const status=['跟踪中','需要复核','逻辑失效','完成复盘'].includes(req.body.status)?req.body.status:found.status;
   const note=String(req.body.note||'').trim().slice(0,1000);if(!note)return res.status(400).json({error:'请填写本次判断依据'});
   if(found.notes.length>=100)return res.status(400).json({error:'本卡复核记录已达上限'});
   const entry={at:new Date().toISOString(),status,note};
   if(found.researchId){await researchStore.note(req.user.id,found.researchId,{requestKey:String(req.body.requestKey||crypto.randomUUID()),note,status:status==='逻辑失效'?'invalidated':status==='完成复盘'?'closed':'review'});return res.json({ok:true,researchId:found.researchId})}
   if(pool)await pool.query(`UPDATE radar_journal SET data_json=jsonb_set(jsonb_set(data_json,'{status}',$3::jsonb),'{notes}',(data_json->'notes')||$4::jsonb) WHERE id=$1 AND user_id=$2`,[id,req.user.id,JSON.stringify(status),JSON.stringify([entry])]);
   else {const stored=journal.get(id);stored.data.status=status;stored.data.notes.push(entry)}
   res.json({ok:true});
 }));
 app.post('/api/radar/journal/:id/check',auth,safe(async(req,res)=>{
   if(!pool)throw Error('记录暂不可读取：持久存储未启用');
   const id=req.params.id,found=(await readJournal(req.user.id)).find(j=>j.id===id);if(!found)return res.status(404).json({error:'研究卡不存在'});
   const latest=found.checks.at(-1);if(latest&&Date.now()-Date.parse(latest.at)<300000)return res.json({check:latest,cached:true});
   if(found.checks.length>=200)return res.status(400).json({error:'本卡检查记录已达上限'});
   const q=await quote(found.idea.symbol);const at=new Date().toISOString();
   const check={at,quoteAt:q.marketTime?new Date(q.marketTime*1000).toISOString():null,price:q.price,
     changeFromBaseline:found.baselinePrice>0&&Number.isFinite(q.price)?Number(((q.price/found.baselinePrice-1)*100).toFixed(2)):null,
     disclaimer:'仅比较两个行情快照，非实盘收益；未计费用、分红、复权差异及可成交性。'};
   if(pool)await pool.query(`UPDATE radar_journal SET data_json=jsonb_set(data_json,'{checks}',(data_json->'checks')||$3::jsonb) WHERE id=$1 AND user_id=$2`,[id,req.user.id,JSON.stringify([check])]);
   else journal.get(id).data.checks.push(check);res.json({check});
 }));
}
