import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeOpportunityLifecycle,retentionFor} from './radar-lifecycle.js';

const evidence = date => [{
  title:'召开产品发布会',negative:false,bodyRead:true,publishedAt:'2026-09-20T08:00:00Z',
  eventDates:[{date,inWindow:true}],benefitPassages:[],riskPassages:[],timingPassages:[]
}];
const idea = (symbol,date) => ({symbol,code:symbol.slice(0,6),name:symbol,evidence:evidence(date),rationale:'等待事件验证'});
const report = (id,start,end,candidates) => ({id,window:{start,end,days:30},candidates});

test('known events remain tracked through five-day verification grace period',()=>{
  const rule=retentionFor(idea('000001.SZ','2026-09-25'),{start:'2026-09-21',end:'2026-10-21'},new Date('2026-09-21T02:00:00Z'));
  assert.equal(rule.eventDate,'2026-09-25');
  assert.equal(rule.validUntil,'2026-09-30');
});

test('a new scan cannot silently replace an unexpired opportunity',()=>{
  const first=mergeOpportunityLifecycle([],report('r1','2026-09-21','2026-10-21',[idea('000001.SZ','2026-09-25')]),new Date('2026-09-21T02:00:00Z'));
  assert.equal(first.newCandidates.length,1);
  const second=mergeOpportunityLifecycle(first.entries,report('r2','2026-09-22','2026-10-22',[idea('000002.SZ','2026-10-01')]),new Date('2026-09-22T02:00:00Z'));
  assert.deepEqual(second.candidates.map(x=>x.symbol),['000001.SZ','000002.SZ']);
  assert.deepEqual(second.newCandidates.map(x=>x.symbol),['000002.SZ']);
  assert.deepEqual(second.continuingCandidates.map(x=>x.symbol),['000001.SZ']);
  assert.match(second.continuingCandidates[0].lifecycle.reason,/不会|继续保留/);
  assert.equal(second.continuingCandidates[0].lifecycle.firstSeenAt,first.newCandidates[0].lifecycle.firstSeenAt);
});

test('opportunities leave the active pool only after their retention date',()=>{
  const first=mergeOpportunityLifecycle([],report('r1','2026-09-21','2026-10-21',[idea('000001.SZ','2026-09-25')]),new Date('2026-09-21T02:00:00Z'));
  const after=mergeOpportunityLifecycle(first.entries,report('r2','2026-10-01','2026-10-31',[]),new Date('2026-10-01T02:00:00Z'));
  assert.equal(after.candidates.length,0);
  assert.deepEqual(after.expired,['000001.SZ']);
});

test('new adverse evidence marks review instead of deleting the idea',()=>{
  const first=mergeOpportunityLifecycle([],report('r1','2026-09-21','2026-10-21',[idea('000001.SZ','2026-09-25')]),new Date('2026-09-21T02:00:00Z'));
  const changed={...idea('000001.SZ','2026-09-25'),evidence:[...evidence('2026-09-25'),{title:'项目延期风险提示',negative:true,bodyRead:true,publishedAt:'2026-09-22T08:00:00Z',eventDates:[]}]};
  const second=mergeOpportunityLifecycle(first.entries,report('r2','2026-09-22','2026-10-22',[changed]),new Date('2026-09-22T09:00:00Z'));
  assert.equal(second.candidates.length,1);
  assert.equal(second.candidates[0].lifecycle.status,'需要复核');
});

test('a passed locked event cannot be extended by a later rolling window',()=>{
  const first=mergeOpportunityLifecycle([],report('r1','2026-09-01','2026-09-30',[idea('000001.SZ','2026-09-20')]),new Date('2026-09-10T00:00:00Z'));
  const next=mergeOpportunityLifecycle(first.entries,report('r2','2026-09-22','2026-10-21',[idea('000001.SZ','2026-09-20')]),new Date('2026-09-22T00:00:00Z'));
  assert.equal(next.entries[0].validUntil,'2026-09-25');
});

test('a genuinely new event can reopen an expired symbol as a new idea',()=>{
  const expired={symbol:'000001.SZ',status:'已到期',position:1,firstSeenAt:'2026-08-01T00:00:00Z',validUntil:'2026-08-31',idea:idea('000001.SZ','2026-08-20')};
  const next=mergeOpportunityLifecycle([expired],report('r2','2026-09-21','2026-10-21',[idea('000001.SZ','2026-10-01')]),new Date('2026-09-21T00:00:00Z'));
  assert.equal(next.newCandidates.length,1);
  assert.equal(next.newCandidates[0].lifecycle.stage,'本次新发现');
  assert.notEqual(next.newCandidates[0].lifecycle.firstSeenAt,expired.firstSeenAt);
});
