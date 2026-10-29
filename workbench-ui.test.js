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

test('real historical summary is labelled reconstructed and costs use the primary date weighting',async()=>{
 const report=JSON.parse(fs.readFileSync(new URL('./research/results/five-session-2025-v1.1-summary.json',import.meta.url),'utf8'));
 const {nodes,run}=setup();run('globalThis.studyReport='+JSON.stringify(report));
 run("state.page='validation';api=async url=>url==='/api/validation/five-session'?{report:studyReport}:url==='/api/volume-screen/latest'?{result:fixture.scan}:url==='/api/research-history'?{items:fixture.history}:url==='/api/ai/radar-history'?{reports:fixture.reports}:url==='/api/workbench/context'?fixture.context:fixture.model");
 await run('validationPage()');
 const html=nodes.get('#content').innerHTML;
 for(const text of ['2025年事后重建','严格当时价格口径未核验','短期概率不启用','7108 / 7616','93.33%','0.56%','不是实际收益'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<tr>/g)||[]).length,6);
 assert.ok(!html.includes('目前仅有合成自检，没有真实策略成绩'));
});
test('unreadable or non-historical studies never become zero-return or no-opportunity claims',()=>{
 const {run}=setup();
 const html=run("wbHistoricalStudy({approved:true,provenance:'reconstructed'},'合成：来源失配')");
 assert.match(html,/来源失配/);assert.match(html,/不能据此判断没有机会/);
 assert.ok(!html.includes('<table'));
});

test('an older delayed study response cannot overwrite a newer validation-page render',async()=>{
 const {nodes,run}=setup();
 run("state.page='validation';globalThis.studyQueue=[];globalThis.baseApi=api;api=url=>url==='/api/validation/five-session'?new Promise((resolve,reject)=>studyQueue.push({resolve,reject})):baseApi(url)");
 const older=run('validationPage()');
 await new Promise(resolve=>setTimeout(resolve,0));
 const newer=run('validationPage()');
 await new Promise(resolve=>setTimeout(resolve,0));
 run("studyQueue[1].reject(Error('较新请求故障，等待复核'))");
 await newer;
 const expected=nodes.get('#content').innerHTML;
 assert.ok(expected.includes('较新请求故障，等待复核'));
 run("studyQueue[0].reject(Error('较旧请求，不能覆盖'))");
 await older;
 assert.equal(nodes.get('#content').innerHTML,expected);
});

test('malformed group elements or cost arrays show an unreadable report instead of a blank page',()=>{
 const report=JSON.parse(fs.readFileSync(new URL('./research/results/five-session-2025-v1.1-summary.json',import.meta.url),'utf8'));
 for(const mutation of ['null_group','bad_cost','null_cost']){
  const broken=structuredClone(report);
  if(mutation==='null_group')broken.groups[0]=null;
  if(mutation==='bad_cost')broken.groups[0].hypotheticalCostScenarios={};
  if(mutation==='null_cost')broken.groups[0].hypotheticalCostScenarios=[null];
  const {run}=setup();run('globalThis.broken='+JSON.stringify(broken));
  const html=run('wbHistoricalStudy(broken)');
  assert.match(html,/报告暂不可读取/);assert.ok(!html.includes('<table'));
 }
});
