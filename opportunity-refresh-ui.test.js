import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('./research-workbench.js',import.meta.url),'utf8');
const refresh=fs.readFileSync(new URL('./opportunity-refresh.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map(),context=vm.createContext({
  console,Date,Number,Math,JSON,Map,Set,Promise,Object,String,Array,URL,encodeURIComponent,
  setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,
  localStorage:{getItem:()=>null,setItem(){}},location:{reload(){}},
  document:{body:{classList:{add(){},remove(){},toggle(){}}},addEventListener(){},querySelectorAll:()=>[],querySelector(s){
   if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}}});return nodes.get(s);
  }},
  fetch:async()=>({ok:true,json:async()=>({authenticated:false})})
 });
 vm.runInContext(core,context);vm.runInContext(refresh,context);vm.runInContext(app,context);
 return {context,run:code=>vm.runInContext(code,context)};
}
test('account switch cancels an in-flight home task and clears unsaved scan memory',async()=>{
 const {context,run}=setup();
 run("currentUser={username:'old'};state.page='archive';let finishStart;api=()=>new Promise(r=>finishStart=r);globalThis.pendingUpdate=wbStartUpdate()");
 run("currentUser={username:'new'};loadUserState();finishStart({jobId:'old-private-job'})");
 await context.pendingUpdate;
 assert.equal(run('state.wbLatestScan'),null);assert.equal(run('wbRefreshController'),null);
});
test('new unsaved scan remains explicit instead of being replaced with an older saved result',async()=>{
 const {run}=setup();
 run("currentUser={username:'one'};state.page='dashboard';state.wbLatestScan={id:'new-unsaved',createdAt:'2026-10-29T09:00:00Z',coverage:{usable:0},items:[],storage:{durable:false}};api=async url=>url==='/api/volume-screen/latest'?{result:{id:'old-saved',createdAt:'2026-10-28T09:00:00Z',coverage:{usable:2},items:[],storage:{durable:true}}}:url==='/api/research-history'?{items:[]}:url==='/api/ai/radar-history'?{reports:[]}:url==='/api/workbench/context'?{verified:false}:{active:false}");
 const result=await run("wbLoad('dashboard')");
 assert.equal(result.scan.id,'new-unsaved');assert.equal(result.scan.storage.durable,false);
 assert.equal(result.scan.coverage.usable,0);
});

test('late latest-scan response cannot populate a new account or overwrite another page',async()=>{
 for(const switchAccount of [true,false]){
  const {context,run}=setup();
  run("currentUser={username:'one'};state.page='volumeScreen';state.volumeScreen=null;let finishLatest;api=()=>new Promise(r=>finishLatest=r);globalThis.pendingRead=volumeScreenPage()");
  if(switchAccount)run("currentUser={username:'two'};loadUserState()");
  else run("state.page='archive'");
  run("finishLatest({result:{id:'old-private-result'}})");
  await context.pendingRead;
  assert.equal(run('state.volumeScreen'),null);
 }
});
