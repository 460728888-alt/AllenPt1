import test from 'node:test';
import assert from 'node:assert/strict';
import './research-workbench.js';
import {demoData} from './tests/fixtures/workbench.mjs';
const W=globalThis.AllenWorkbench;
test('a failed scan and absent coverage never become no opportunities',()=>{
  assert.equal(W.scanState(null,'all requests failed').key,'failed');
  assert.equal(W.scanState({items:[]}).key,'insufficient');
  assert.equal(W.scanState(null).key,'not_started');
  const data=demoData();data.scan.coverage.usable=0;data.scan.items=[];
  assert.equal(W.scanState(data.scan).key,'insufficient');
});
test('coverage retains requested, returned, usable and failed as distinct nullable fields',()=>{
  const c=W.coverage(demoData().scan);
  assert.equal(c.requested,12);assert.equal(c.returned,11);assert.equal(c.failed,1);assert.equal(c.usable,10);
  assert.equal(c.qualified,null);assert.equal(W.coverage({}).usable,null);
  assert.equal(W.number(null),null);assert.equal(W.number(''),null);assert.equal(W.number(NaN),null);
});
test('freshness is checked against the current completed market session',()=>{
  const data=demoData(),snapshot=data.records[0].original;
  assert.equal(W.quality(snapshot,data.context).state,'stale');
  assert.equal(W.quality(snapshot,{}).state,'unverified');
  assert.equal(W.quality({...snapshot,dataThrough:'2099-01-01'},data.context).state,'insufficient');
  assert.equal(W.stage(snapshot,data.context).key,'paused');
});
test('simultaneous positive fields cannot invent a prior uptrend or confirmed strategy',()=>{
  const data=demoData(),snapshot=data.records[0].events[2].payload.snapshot;
  const facts=W.facts(snapshot);
  assert.equal(facts.find(x=>x.id==='trend').state,'unknown');
  assert.equal(facts.find(x=>x.id==='volume').state,'supported');
  assert.equal(W.stage(snapshot,data.context).key,'compression');
  const trigger={...snapshot,price:12.1,structure:{...snapshot.structure,volume:{ratio:1.6}}};
  assert.equal(W.stage(trigger,data.context).key,'trigger');
  assert.match(W.stage(trigger,data.context).label,/待确认/);
});
test('missing volume and data gaps cannot be displayed as current contraction evidence',()=>{
  const data=demoData(),gap=data.records[2].events[1].payload.snapshot;
  assert.equal(W.facts(gap).find(x=>x.id==='volume').state,'unknown');
  const noRatio={...data.records[0].original,profile:{volumeDriedUp:true}};
  assert.equal(W.facts(noRatio).find(x=>x.id==='volume').state,'unknown');
});
test('persisted invalidation remains visible even if the next observation is missing',()=>{
  const data=demoData(),item={...data.records[2].events[1].payload.snapshot,researchStatus:'invalidated'};
  assert.equal(W.stage(item,data.context).key,'invalid');
});
test('same stock has separate episodes and stable order independent of request ordering',()=>{
  const data=demoData(),other={...data.history[0],researchId:'DEMO-ANOTHER-EPISODE'};
  const rows=[...data.history,other];
  const first=W.cards(data.scan,rows,data.context),second=W.cards(data.scan,[...rows].reverse(),data.context);
  assert.equal(first.filter(c=>c.symbol==='DEMO-A.SS').length,2);
  assert.deepEqual(first.map(c=>c.viewId),second.map(c=>c.viewId));
  assert.ok(first.some(c=>c.phase.key==='invalid'));
  assert.ok(first.some(c=>c.phase.key==='paused'));
});
test('original replay never includes later data, status or user notes',()=>{
  const record=demoData().records[0],frozen=JSON.stringify(record);
  const original=W.asOf(record,'original'),later=W.asOf(record,'later');
  assert.equal(original.snapshot.dataThrough,'2026-10-12');
  assert.equal(original.events.length,0);
  assert.equal(original.snapshot.price,11.5);
  assert.equal(later.snapshot.dataThrough,'2026-10-14');
  assert.equal(later.events.length,4);
  assert.equal(JSON.stringify(record),frozen);
  assert.throws(()=>W.asOf({events:[]}),/没有真实原始快照/);
});
test('sparse observation chart excludes missing prices without fabricating daily bars',()=>{
  const data=demoData(),record=data.records[0],gap=data.records[2];
  assert.equal(W.points(record,'original').length,1);
  assert.equal(W.points(record,'later').length,3);
  assert.equal(W.points(gap,'later').length,1);
  assert.ok(W.points(gap,'later').every(point=>point.price>0));
});
test('event evidence is kept separate from price confirmation',()=>{
  const data=demoData(),item={...data.records[0].events[2].payload.snapshot,channel:'radar'};
  assert.equal(W.stage(item,data.context).key,'event');
});
