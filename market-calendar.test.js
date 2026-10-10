import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadMarketCalendar,buildMarketCalendar} from './market-calendar.js';
import {calendarExpectation,normalizeDailyChart} from './data-contract.js';
const calendar=loadMarketCalendar('');
const at = date => calendarExpectation(calendar,new Date(date));

test('bundled official calendar reproduces the reviewed holiday definition',()=>{
  const definition=JSON.parse(fs.readFileSync(new URL('./calendars/cn-equities-holidays.json',import.meta.url),'utf8'));
  assert.deepEqual(calendar,buildMarketCalendar(definition));
  assert.deepEqual(calendar.sessions.reduce((counts,d)=>(counts[d.slice(0,4)]=(counts[d.slice(0,4)]||0)+1,counts),{}),{'2024':242,'2025':243,'2026':242});
  assert.ok(calendar.sessions.every(d=>![0,6].includes(new Date(d).getUTCDay())));
});
test('exchange holidays and government makeup weekends are closed',()=>{
  for(const d of ['2024-02-09','2024-02-18','2025-01-28','2025-02-04','2025-02-08','2025-10-08','2026-02-23','2026-02-28','2026-05-05','2026-05-09','2026-09-25','2026-10-07','2026-10-10'])assert.ok(!calendar.sessions.includes(d),d);
  for(const d of ['2024-02-19','2025-02-05','2025-10-09','2026-02-24','2026-05-06','2026-09-28','2026-10-08'])assert.ok(calendar.sessions.includes(d),d);
  assert.equal(at('2026-10-07T16:00:00+08:00').expected,'2026-09-30');
  assert.equal(at('2026-10-10T08:00:00+08:00').expected,'2026-10-09');
  assert.equal(at('2026-10-10T08:00:00+08:00').sessionState,'weekend');
});
test('Shanghai close boundary, year rollover and calendar expiry fail safely',()=>{
  assert.equal(at('2026-10-08T15:04:59+08:00').expected,'2026-09-30');
  assert.equal(at('2026-10-08T15:05:00+08:00').expected,'2026-10-08');
  assert.equal(at('2026-01-01T16:00:00+08:00').expected,'2025-12-31');
  assert.equal(at('2027-01-01T00:00:00+08:00').verified,false);
  assert.equal(loadMarketCalendar('/nonexistent/explicit-calendar.json'),null);
  for(const change of [{validThrough:'invalid'},{sessions:[...calendar.sessions,calendar.sessions.at(-1)]},{sessions:['2023-12-29',...calendar.sessions]}])assert.equal(calendarExpectation({...calendar,...change},new Date('2026-10-09T08:00:00Z')).verified,false);
});
test('official calendar preserves a missing session across a holiday without fabricating holiday bars',()=>{
  const dates=calendar.sessions.filter(d=>d<='2026-10-09').slice(-65);
  const chart=ds=>({timestamp:ds.map(d=>Date.parse(d+'T01:30:00Z')/1000),indicators:{quote:[{open:ds.map(()=>11),high:ds.map(()=>12),low:ds.map(()=>10),close:ds.map(()=>11),volume:ds.map(()=>1000)}],adjclose:[{adjclose:ds.map(()=>11)}]}});
  const options={symbol:'600001.SS',calendar,now:new Date('2026-10-10T00:00:00Z')};
  const good=normalizeDailyChart(chart(dates),options);assert.equal(good.data.state,'ok');assert.equal(good.data.dataThrough,'2026-10-09');
  const gap=normalizeDailyChart(chart(dates.filter(d=>d!=='2026-10-08')),options);assert.equal(gap.data.state,'insufficient');assert.ok(gap.rows.find(r=>r.date==='2026-10-08').missingSession);
  assert.equal(gap.rows.some(r=>r.date==='2026-10-07'),false);
  const stale=normalizeDailyChart(chart(dates.slice(0,-1)),options);assert.equal(stale.data.state,'stale');assert.equal(stale.data.expectedThrough,'2026-10-09');
});
