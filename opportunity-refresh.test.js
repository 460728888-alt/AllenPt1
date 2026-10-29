import test from 'node:test';
import assert from 'node:assert/strict';
import './opportunity-refresh.js';
const C=globalThis.AllenOpportunityRefresh;
const result={createdAt:'2026-10-29T08:00:00Z',coverage:{usable:0,requested:12},items:[],storage:{durable:false}};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
test('rapid repeated clicks share one POST and one polling loop',async()=>{
 let starts=0,reads=0;const hold=deferred();
 const c=new C({start:async()=>{starts++;await hold.promise;return {jobId:'one'}},read:async()=>{reads++;return {status:'done',result}},sleep:async()=>{}});
 const a=c.run(),b=c.run();assert.equal(a,b);hold.resolve();await a;
 assert.equal(starts,1);assert.equal(reads,1);assert.equal(c.state.phase,'done');
 assert.equal(c.state.result.coverage.usable,0);
});
test('late start response after account cancellation cannot publish job state',async()=>{
 const hold=deferred();let reads=0,done=0;
 const c=new C({start:()=>hold.promise,read:async()=>{reads++},sleep:async()=>{},onDone:()=>{done++}});
 const p=c.run();c.cancel();hold.resolve({jobId:'old-user-job'});await p;
 assert.equal(c.state.phase,'idle');assert.equal(reads,0);assert.equal(done,0);
});
test('late polling response after account cancellation cannot publish old results',async()=>{
 const hold=deferred(),requested=deferred();let done=0;
 const c=new C({start:async()=>({jobId:'old'}),read:()=>{requested.resolve();return hold.promise},sleep:async()=>{},onDone:()=>{done++}});
 const p=c.run();await requested.promise;c.cancel();hold.resolve({status:'done',result});await p;
 assert.equal(c.state.phase,'idle');assert.equal(done,0);
});
test('poll errors retain the job ID; retry reads same task without a second POST',async()=>{
 let starts=0,broken=true;
 const c=new C({start:async()=>{starts++;return {jobId:'one'}},read:async()=>{if(broken)throw Error('offline');return {status:'done',result}},sleep:async()=>{}});
 await c.run();assert.equal(c.state.phase,'error');assert.equal(c.state.jobId,'one');
 broken=false;await c.run();assert.equal(starts,1);assert.equal(c.state.phase,'done');
});
test('missing result is an explicit error and cannot fabricate an empty opportunity list',async()=>{
 const c=new C({start:async()=>({jobId:'one'}),read:async()=>({status:'done'}),sleep:async()=>{}});
 await c.run();assert.equal(c.state.phase,'error');assert.equal(c.state.result,null);
});
test('a lost server task allows a new start instead of an endless stale resume',async()=>{
 let missing=true,starts=0;
 const c=new C({start:async()=>{starts++;return {jobId:'one'}},read:async()=>{if(missing)throw Object.assign(Error('missing'),{status:404});return {status:'done',result}},sleep:async()=>{}});
 await c.run();assert.equal(c.state.jobId,null);assert.equal(c.state.phase,'error');
 missing=false;await c.run();assert.equal(starts,2);
});
test('saving failure remains a visible result without changing original data',async()=>{
 const original=JSON.stringify(result);
 const c=new C({start:async()=>({jobId:'one'}),read:async()=>({status:'done',result}),sleep:async()=>{}});
 await c.run();assert.equal(c.state.result.storage.durable,false);assert.equal(JSON.stringify(result),original);
});
