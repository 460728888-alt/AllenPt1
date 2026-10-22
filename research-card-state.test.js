import test from 'node:test';
import assert from 'node:assert/strict';
import {researchCardState as card} from './research-card-state.js';

// Synthetic fixtures, not market results.
const current=(extra={})=>({dataThrough:'2026-10-14',data:{state:'ok'},price:11,tone:'yellow',...extra});
const stored=(status='tracking',kind='refreshed')=>({
  research_id:'synthetic-episode',snapshot:{dataThrough:'2026-10-12',levels:{stop:10}},
  snapshot_hash:'synthetic-only',latest_state:{status,kind,dataThrough:'2026-10-14'}
});
test('invalid data states pause the card instead of invalidating the hypothesis',()=>{
  for(const state of ['insufficient','stale','request_failed',undefined]) {
    const r=card(current({data:{state},price:8}),stored());
    assert.equal(r.tone,'orange');assert.equal(r.originalInvalid,false);
    assert.equal(r.researchStatus,'tracking');
  }
});
test('missing, malformed and nonpositive prices cannot invalidate a card',()=>{
  for(const price of [null,undefined,NaN,Infinity,'',0,-1]) {
    const r=card(current({price}),stored());
    assert.equal(r.tone,'orange');assert.equal(r.originalInvalid,false);
  }
});
test('missing or impossible cutoff dates pause the card',()=>{
  for(const dataThrough of [null,'','2026-02-30','2026-13-01']) {
    assert.equal(card(current({dataThrough}),stored()).status,'当前数据待核验');
  }
});
test('a persisted gap remains paused even if the new card claims good data',()=>{
  assert.equal(card(current(),stored('tracking','data_gap')).status,'当前数据待核验');
});
test('older observations do not change the recorded judgment',()=>{
  const r=card(current({dataThrough:'2026-10-13',price:8}),stored());
  assert.equal(r.tone,'orange');assert.equal(r.researchStatus,'tracking');
  assert.match(r.reason,/早于/);
});
test('a raw price comparison alone cannot create an invalidated judgment',()=>{
  const r=card(current({price:8}),stored());
  assert.equal(r.tone,'orange');assert.equal(r.originalInvalid,false);
});
test('an incoming red marker cannot override a tracking event',()=>{
  const r=card(current({tone:'red',originalInvalid:true}),stored());
  assert.equal(r.tone,'orange');assert.equal(r.originalInvalid,false);
});
test('a recorded invalidation remains visible when current data are unavailable',()=>{
  const r=card(current({data:{state:'insufficient'},price:null}),stored('invalidated','invalidated'));
  assert.equal(r.tone,'red');assert.equal(r.originalInvalid,true);
  assert.match(r.reason,/已留档/);
});
test('normal tracking keeps the observation category',()=>{
  assert.equal(card(current(),stored()).tone,'yellow');
});
test('closed and expired episodes cannot appear as active confirmations',()=>{
  for(const status of ['closed','expired']) {
    const r=card(current({tone:'green'}),stored(status));
    assert.equal(r.tone,'orange');assert.equal(r.status,'原研究已结束');
  }
});
test('review status is explicit',()=>{
  assert.equal(card(current(),stored('review','note')).status,'原判断需要复核');
});
test('the original stop never follows a recalculated stop',()=>{
  assert.equal(card(current({giveUpPrice:9,levels:{stop:9}}),stored()).giveUpPrice,10);
});
test('missing and unknown event statuses pause the card',()=>{
  const r=stored();delete r.latest_state;
  assert.equal(card(current(),r).tone,'orange');
  assert.equal(card(current(),stored('unknown')).tone,'orange');
});
test('a missing original fails explicitly',()=>{
  assert.throws(()=>card(current(),null),/快照读取失败/);
});
test('inputs and original snapshot are not modified',()=>{
  const a=current(),b=stored(),before=JSON.stringify([a,b]);
  Object.freeze(a);Object.freeze(b.snapshot.levels);Object.freeze(b.snapshot);
  Object.freeze(b.latest_state);Object.freeze(b);
  card(a,b);assert.equal(JSON.stringify([a,b]),before);
});
