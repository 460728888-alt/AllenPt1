import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {validateCriteria,extractEvidence,normalizeFeed,historyChange,buildRadar} from './radar-engine.js';
import {registerRadar} from './radar-api.js';

const criteria=validateCriteria({days:30,announcementLimit:1000,risk:'高',maxRunup:30});
const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
const futureText=tomorrow.replace(/(\d{4})-(\d{2})-(\d{2})/,'$1年$2月$3日');
const body=('公司计划于'+futureText+'召开产品发布会。预计对营业收入产生积极影响，具体以审计数据为准。市场需求仍有不确定性。').repeat(4);
const feedRows=Array.from({length:70},(_,i)=>({art_code:'AN20260913000'+i,title:'公司'+i+'新产品发布公告',notice_date:tomorrow,
 display_time:new Date(Date.now()+8*3600000-60000).toISOString().slice(0,19).replace('T',' '),codes:[{stock_code:String(600000+i),short_name:'测试公司'+i}]}));
const quotes={price:100,marketTime:Math.floor(Date.now()/1000),history:Array.from({length:90},()=>({close:100})),technical:{score:55}};
const dependencies={feed:async()=>({items:feedRows,pages:10,failedPages:0}),market:async()=>({rows:[],total:5000,pages:50}),
 content:async()=>({text:body}),quote:async()=>quotes,research:async()=>({company:{industry:'测试行业'},finance:{profitGrowth:10,reportDate:'2026-06-30'}})};
test('reject invalid selectors and preserve choices',()=>{
 assert.equal(criteria.risk,'高');assert.equal(criteria.announcementLimit,1000);
 for(const value of [{days:2},{announcementLimit:9999},{maxRunup:-1},{eventType:'凭空预测'}])assert.throws(()=>validateCriteria(value));
});
test('publication != event; body date carries original passage',()=>{
 const e=extractEvidence({title:'新产品发布公告',text:body,date:'2020-01-01'},criteria.window);
 assert.ok(e.bodyRead);assert.ok(e.eventDates.some(x=>x.inWindow));assert.ok(e.riskPassages.length);
 const undated=extractEvidence({title:'重大合同',text:'履行时间待定。'.repeat(30)},criteria.window);assert.equal(undated.eventDates.length,0);
});
test('already visible future-dated notice accepted; unpublished content excluded',()=>{
 assert.equal(normalizeFeed(feedRows).length,70);
 assert.equal(normalizeFeed([{...feedRows[0],display_time:'2099-01-01 12:00:00'}]).length,0);
});
test('history missing is unknown, not zero',()=>{assert.equal(historyChange([],20),null);assert.equal(historyChange(quotes.history,20),0)});
test('broad universe counts and deep limits are distinct',async()=>{
 const r=await buildRadar(criteria,dependencies);assert.equal(r.coverage.uniqueStocks,70);assert.equal(r.coverage.researched,40);assert.equal(r.coverage.assessed,12);assert.equal(r.candidates.length,8);assert.equal(r.candidates[0].return20,0);
});
test('unknown history fails max-runup filter',async()=>{
 const r=await buildRadar(criteria,{...dependencies,quote:async()=>({price:10,history:[]})});assert.equal(r.candidates.length,0);assert.equal(r.excluded.length,12);
});
test('missing body and unavailable AI are transparent',async()=>{
 const r=await buildRadar(criteria,{...dependencies,content:async()=>{throw Error('missing')},ai:async()=>{throw Error('no key')}});
 assert.equal(r.coverage.fullBodies,0);assert.equal(r.candidates[0].group,'时间待核验');assert.match(r.aiStatus,/不可用/);
});
test('API jobs, account isolation, append-only reviews, snapshots',async()=>{
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={id:req.headers['x-test-user'],username:req.headers['x-test-user']};next()};
 registerRadar({app,auth,pool:null,market:dependencies.market,research:dependencies.research,quote:dependencies.quote,ai:null,
 publicJson:async url=>url.includes('/content/')?{data:{notice_content:body,page_size:1}}:{data:{list:feedRows}}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const request=(path,user='one',data)=>fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(user?{'x-test-user':user}:{})},...(data?{body:JSON.stringify(data)}:{})});
 try{
  assert.equal((await request('/api/radar/journal',null)).status,401);
  assert.equal((await request('/api/ai/screen','one',{days:0})).status,400);
  const start=await request('/api/ai/screen','one',{days:30,risk:'高'});assert.equal(start.status,202);const {jobId}=await start.json();
  assert.equal((await request('/api/ai/radar-jobs/'+jobId,'two')).status,404);
  let job;for(let n=0;n<30;n++){job=await(await request('/api/ai/radar-jobs/'+jobId)).json();if(job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(job.status,'done');assert.equal(job.result.risk,'高');assert.equal(job.result.durable,false);
  assert.equal((await(await request('/api/ai/radar-history','two')).json()).reports.length,0);
  const input={reportId:job.result.id,symbol:job.result.candidates[0].symbol};
  const entry=await(await request('/api/radar/journal','one',input)).json();assert.ok(entry.item.id);
  assert.equal((await request('/api/radar/journal','two',input)).status,404);
  const id=entry.item.id;
  assert.equal((await request('/api/radar/journal/'+id+'/review','two',{note:'not mine'})).status,404);
  await request('/api/radar/journal/'+id+'/review','one',{status:'需要复核',note:'检查交付证据'});
  await request('/api/radar/journal/'+id+'/review','one',{status:'逻辑失效',note:'计划已取消'});
  const check=await(await request('/api/radar/journal/'+id+'/check','one',{})).json();assert.equal(check.check.changeFromBaseline,0);
  const stored=(await(await request('/api/radar/journal')).json()).items[0];assert.equal(stored.notes.length,2);assert.equal(stored.status,'逻辑失效');
  const original=(await(await request('/api/ai/radar-history')).json()).reports[0];assert.deepEqual(original,job.result);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
