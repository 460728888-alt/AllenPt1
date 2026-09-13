import test from 'node:test';
import assert from 'node:assert/strict';
import {radarWindow,titleEvidence,radarCandidate,mapLimit} from './opportunity.js';
const window=radarWindow(30,new Date('2026-09-13T00:00:00Z'));
test('validates windows',()=>{assert.equal(window.end,'2026-10-13');assert.throws(()=>radarWindow(365));});
test('publication date is not a catalyst date',()=>{
 const e=titleEvidence([{title:'关于签订重大合同的公告',date:'2026-09-12'}],window)[0];
 assert.equal(e.eventDate,null);assert.equal(e.inWindow,false);
});
test('planned dates must be future and inside window',()=>{
 const make=date=>({title:'定于'+date+'召开业绩说明会',date:'2026-09-12'});
 assert.equal(titleEvidence([make('2026年9月20日')],window)[0].inWindow,true);
 assert.equal(titleEvidence([make('2026年11月20日')],window)[0].inWindow,false);
 assert.equal(titleEvidence([make('2026年2月30日')],window)[0].eventDate,null);
});
test('future publications excluded; negative titles remain counterevidence',()=>{
 assert.equal(titleEvidence([{title:'回购公告',date:'2026-09-14'}],window).length,0);
 assert.equal(titleEvidence([{title:'终止回购公告',date:'2026-09-12'}],window)[0].negative,true);
 assert.equal(radarCandidate({}, {announcements:[]},window),null);
});
test('risk changes hot-stock priority, never creates probability',()=>{
 const stock={changePct:7},r={announcements:[{title:'回购公告',date:'2026-09-12'}]};
 assert.ok(radarCandidate(stock,r,window,'低').priority<radarCandidate(stock,r,window,'高').priority);
});
test('bounded fetch preserves failures',async()=>{
 let active=0,max=0;
 const out=await mapLimit([1,2,3,4],2,async n=>{active++;max=Math.max(max,active);await Promise.resolve();active--;if(n===3)throw Error();return n});
 assert.ok(max<=2);assert.equal(out[2].ok,false);assert.equal(out[3].value,4);
});
