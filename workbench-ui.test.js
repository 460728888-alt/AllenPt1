import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {demoData} from './tests/fixtures/workbench.mjs';
const core=fs.readFileSync(new URL('./research-workbench.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function setup(data=demoData()){
  const nodes=new Map(),body={classList:{add(){},remove(){},toggle(){}}};
  const context=vm.createContext({
    console,Date,Number,Math,JSON,Map,Set,Promise,Object,String,Array,URL,crypto:{randomUUID:()=> 'synthetic-request'},
    encodeURIComponent,setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,
    localStorage:{getItem:()=>null,setItem:()=>{}},location:{reload(){}},
    document:{body,addEventListener(){},querySelector(selector){
      if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},insertAdjacentHTML(_,html){this.innerHTML=html+this.innerHTML}});
      return nodes.get(selector);
    }},
    fetch:async()=>({ok:true,json:async()=>({authenticated:false})})
  });
  vm.runInContext(core,context);vm.runInContext(app,context);
  context.fixture=data;
  const run=code=>vm.runInContext(code,context);
  run("currentUser={username:'synthetic'};state.watch=[];state.portfolio=[];api=async url=>url==='/api/volume-screen/latest'?{result:fixture.scan}:url==='/api/research-history'?{items:fixture.history}:url==='/api/ai/radar-history'?{reports:fixture.reports}:url==='/api/workbench/context'?fixture.context:fixture.model");
  return {nodes,run};
}
test('home explains priority, unmet conditions, abandonment and unset risk without fake probability',async()=>{
  const {nodes,run}=setup();run("state.page='dashboard'");await run('dashboard()');
  const html=nodes.get('#content').innerHTML;
  for(const text of ['优先研究清单','还差什么','什么时候放弃','风险预算','待设置','事件雷达','合格候选：未判定'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('上涨概率 80'));assert.ok(!html.includes('确定买点'));
  assert.ok(html.includes('data-wb-open='));
});
test('all backend errors are visible instead of a clean empty opportunity list',async()=>{
  const {nodes,run}=setup();run("state.page='dashboard';api=async()=>{throw Error('合成数据库故障')}");
  await run('dashboard()');const html=nodes.get('#content').innerHTML;
  assert.match(html,/无法完成判断/);assert.match(html,/合成数据库故障/);
  assert.ok(!html.includes('已核验范围暂无结构观察'));
});
test('replay renders original conditions and excludes later notes until time switch',()=>{
  const data=demoData(),record={...data.records[0],snapshotVerified:true,snapshotHash:'synthetic-hash',
    strategyVersion:'synthetic',generatedAt:'2026-10-12T08:00:00Z'};
  const {nodes,run}=setup(data);run("state.archiveItem={channel:'volume'};state.archiveRecord="+JSON.stringify(record)+";state.archiveMode='original';wbRenderArchive()");
  assert.ok(!nodes.get('#content').innerHTML.includes('演示：后来追加的复核笔记'));
  run("state.archiveMode='later';wbRenderArchive()");
  assert.match(nodes.get('#content').innerHTML,/演示：后来追加的复核笔记/);
  assert.match(nodes.get('#content').innerHTML,/不是每日K线/);
  assert.match(nodes.get('#content').innerHTML,/不是收益承诺/);
});
test('untrusted opportunity names and notes are escaped in the new views',async()=>{
  const data=demoData();data.history[0].name='<img src=x onerror=alert(1)>';data.scan.items[0].name=data.history[0].name;
  const {nodes,run}=setup(data);run("state.page='dashboard'");await run('dashboard()');
  const html=nodes.get('#content').innerHTML;assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);
});
test('switching accounts clears archive, board and current context caches',()=>{
  const {run}=setup();
  run("state.archiveRecord={secret:1};state.archiveContext={secret:1};state.wb={secret:1};loadUserState()");
  assert.equal(run('state.archiveRecord'),null);assert.equal(run('state.archiveContext'),null);assert.equal(run('state.wb'),null);
});
test('fresh accounts are not given a fictional holding or investment thesis',()=>{
  const {run}=setup();
  assert.equal(run('state.portfolio.length'),0);
  assert.equal(run('state.theses.length'),0);
});
