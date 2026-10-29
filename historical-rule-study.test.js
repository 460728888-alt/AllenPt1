import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadMarketCalendar} from './market-calendar.js';
import {parseHistory,historyAsOf,observeRules,runRuleStudy} from './historical-rule-study.js';

const calendar=loadMarketCalendar();
const frozen=JSON.parse(fs.readFileSync(new URL('./research/five-session-protocol.json',import.meta.url),'utf8'));
const protocol={...frozen,validationFrom:'2025-01-02',validationThrough:'2025-03-31',requestThrough:'2025-03-31',
 universe:[{symbol:'AAA.SS',name:'Synthetic A'},{symbol:'BBB.SZ',name:'Synthetic B'}],benchmark:'INDEX.SS'};
const dates=calendar.sessions.filter(d=>d>=protocol.requestFrom&&d<=protocol.requestThrough);
const day='2025-01-02';
const make=(symbol,{flat=false}={})=>({symbol,actions:[],rows:dates.map((date,i)=>{
 const close=flat?100:100+i*.2;
 return {date,open:close-.1,high:close+1,low:close-1,close,volume:100000,adjustmentFactor:1};
})});
const stock=()=>make('AAA.SS'),index=()=>make('INDEX.SS');
const study=(changes={})=>runRuleStudy({protocol,calendar,series:[stock(),make('BBB.SZ'),index()],
 reconstructedAt:'2026-10-29T08:00:00.000Z',...changes});
const clone=x=>structuredClone(x);
const resultAt=(report,symbol='AAA.SS',date=day)=>report.ledger.find(r=>r.symbol===symbol&&r.dataThrough===date);
const group=(report,id='all_readable')=>report.groups.find(g=>g.id===id);
const provider=()=>({
 meta:{symbol:'AAA.SS',regularMarketPrice:999999},
 timestamp:[Date.parse(day+'T09:30:00+08:00')/1000],
 indicators:{quote:[{open:[100],high:[102],low:[99],close:[101],volume:[null]}],adjclose:[{adjclose:[101]}]}
});

test('provider adapter keeps missing volume unknown and strips current metadata',()=>{
 const parsed=parseHistory(provider(),'AAA.SS',protocol);
 assert.equal(parsed.rows[0].volume,null);
 assert.equal(parsed.meta,undefined);
 assert.deepEqual(Object.keys(parsed).sort(),['actions','rows','symbol']);
});
test('provider adapter rejects wrong symbol, duplicate and out-of-window sessions',()=>{
 assert.throws(()=>parseHistory(provider(),'WRONG.SS',protocol),/symbol mismatch/);
 const duplicate=provider();duplicate.timestamp.push(duplicate.timestamp[0]);
 assert.throws(()=>parseHistory(duplicate,'AAA.SS',protocol),/duplicate/);
 const future=provider();future.timestamp=[Date.parse('2026-01-05T09:30:00+08:00')/1000];
 assert.throws(()=>parseHistory(future,'AAA.SS',protocol),/outside frozen/);
});
test('an intermediate missing session is not compressed out of a 60-session feature window',()=>{
 const data=stock(),position=data.rows.findIndex(r=>r.date===day);
 data.rows.splice(position-11,1);
 assert.throws(()=>historyAsOf(data,day,calendar.sessions),/missing_historical_session/);
});
test('missing and zero volume cannot create a shrink-volume observation',()=>{
 for(const value of [null,0]){
  const data=stock();data.rows.find(r=>r.date===day).volume=value;
  assert.throws(()=>observeRules(data,day,calendar.sessions),/成交量/);
  const report=study({series:[data,index()]});
  assert.equal(resultAt(report).state,'features_unavailable');
  assert.equal(resultAt(report).rules,undefined);
 }
});
test('adjustment gaps and split volume ambiguity stop feature evaluation',()=>{
 const missing=stock();missing.rows.find(r=>r.date===day).adjustmentFactor=null;
 assert.throws(()=>historyAsOf(missing,day,calendar.sessions),/adjustment_factor_missing/);
 const split=stock();split.actions.push({type:'splits',date:day});
 assert.throws(()=>historyAsOf(split,day,calendar.sessions),/split_volume_basis_unverified/);
});
test('past features are unchanged by extreme later prices and later corporate actions',()=>{
 const before=stock(),after=clone(before);
 for(const row of after.rows)if(row.date>day){row.close=900000;row.open=800000;row.high=999999;row.low=700000;row.adjustmentFactor=.001}
 after.actions.push({date:'2025-02-03',type:'splits'});
 after.rows.push({date:'2026-01-05',open:1,high:2,low:.5,close:1,volume:1,adjustmentFactor:.00001});
 assert.deepEqual(observeRules(before,day,calendar.sessions),observeRules(after,day,calendar.sessions));
});
test('features use the decision-day adjustment anchor and only preceding calendar sessions',()=>{
 const data=stock(),position=data.rows.findIndex(r=>r.date===day);
 data.rows[position-1].adjustmentFactor=.8;data.rows[position].adjustmentFactor=1;
 const selected=historyAsOf(data,day,calendar.sessions);
 assert.equal(selected.length,60);assert.equal(selected.at(-1).date,day);
 assert.equal(selected.at(-2).close,data.rows[position-1].close*.8);
 assert.equal(selected.at(-1).close,data.rows[position].close);
 assert.throws(()=>historyAsOf(data,'2025-01-01',calendar.sessions),/not_in_calendar/);
});
test('labels use exactly next open through fifth official session close with real reconstruction time',()=>{
 const report=study(),row=resultAt(report),position=calendar.sessions.indexOf(day);
 const next5=calendar.sessions.slice(position+1,position+6),data=stock();
 assert.equal(row.entryDate,next5[0]);assert.equal(row.labelThrough,next5[4]);
 assert.equal(row.outcome.entryPrice,data.rows.find(r=>r.date===next5[0]).open);
 assert.equal(row.outcome.exitPrice,data.rows.find(r=>r.date===next5[4]).close);
 assert.equal(row.outcome.rawReturn,row.outcome.exitPrice/row.outcome.entryPrice-1);
 assert.equal(row.provenance,'reconstructed');assert.equal(row.generatedAt,undefined);
 assert.equal(row.reconstructedAt,'2026-10-29T08:00:00.000Z');
 assert.equal(row.decisionAsOf,day+'T16:00:00+08:00');
 assert.equal(report.approved,false);assert.equal(report.winner,null);
 assert.equal(report.probabilitiesEnabled,false);assert.equal(report.liveStrategyChanged,false);
});
test('boundary-overlapping labels are purged before future data can be inspected',()=>{
 const without=study(),withFuture=stock();
 withFuture.rows.push({date:'2026-01-05',open:1,high:2,low:.5,close:1,volume:1,adjustmentFactor:1});
 const after=study({series:[withFuture,make('BBB.SZ'),index()]});
 assert.deepEqual(after.groups,without.groups);
 const last=calendar.sessions.filter(d=>d<=protocol.validationThrough).at(-1);
 assert.equal(resultAt(after,'AAA.SS',last).state,'purged_boundary');
 assert.equal(resultAt(after,'AAA.SS',last).rules,undefined);
 assert.equal(after.coverage.purgedBoundary,10);
});
test('missing benchmark or one benchmark bar preserves valid stock labels and exposes missing coverage',()=>{
 const complete=study(),missing=study({series:[stock(),make('BBB.SZ')]});
 assert.equal(group(missing).labelledStockDays,group(complete).labelledStockDays);
 assert.equal(missing.coverage.benchmarkAvailable,false);
 assert.equal(group(missing).dailyEqualWeightMeanIndexExcess,null);
 assert.equal(missing.status,'partial_exploratory_study');
 const b=index(),entry=calendar.sessions[calendar.sessions.indexOf(day)+1];
 b.rows=b.rows.filter(r=>r.date!==entry);
 const partial=study({series:[stock(),make('BBB.SZ'),b]});
 assert.equal(resultAt(partial).outcome.rawReturn,resultAt(complete).outcome.rawReturn);
 assert.equal(resultAt(partial).outcome.benchmarkReturn,null);
 assert.ok(partial.coverage.missingBenchmarkLabels>0);
 assert.equal(partial.status,'partial_exploratory_study');
});
test('missing future stock volume and label-window actions remain disclosed unavailable outcomes',()=>{
 const data=stock(),entry=calendar.sessions[calendar.sessions.indexOf(day)+1];
 data.rows.find(r=>r.date===entry).volume=null;
 const missing=study({series:[data,index()]});
 assert.equal(resultAt(missing).state,'unavailable');
 assert.equal(resultAt(missing).outcome.reason,'future_price_or_volume_unavailable');
 assert.ok(group(missing).labelMissing>0);
 const action=stock();action.actions.push({type:'dividends',date:entry});
 const report=study({series:[action,index()]});
 assert.equal(resultAt(report).outcome.reason,'label_window_corporate_action');
 assert.equal(resultAt(report).rules.all_readable,true);
});
test('all failed downloads produce unable-to-study, unknown metrics and retained failure reasons',()=>{
 const downloads=[{symbol:'AAA.SS',state:'failed',reason:'HTTP 429'}];
 const report=study({series:[],downloads});
 assert.equal(report.status,'unable_to_study');
 assert.equal(report.coverage.receivedStocks,0);
 assert.equal(group(report).dailyEqualWeightMeanPriceReturn,null);
 assert.equal(group(report).grossPositivePriceFraction,null);
 assert.equal(report.downloads[0].reason,'HTTP 429');
 assert.ok(report.coverage.exclusionReasons.source_unavailable>0);
});
test('zero rule signals are distinct from unavailable data; flat prices are not positive outcomes',()=>{
 const report=study({series:[make('AAA.SS',{flat:true}),make('BBB.SZ',{flat:true}),index()]});
 const noSignal=group(report,'simple_trend');
 assert.equal(noSignal.signalStockDays,0);assert.equal(noSignal.grossPositivePriceFraction,null);
 assert.equal(noSignal.uncertainty.rawReturn.state,'insufficient_dates');
 const flat=make('AAA.SS',{flat:true});for(const row of flat.rows)row.open=row.close;
 const flatReport=study({series:[flat,index()]});
 assert.equal(group(flatReport).grossPositivePriceFraction,0);
});
test('date-block uncertainty is deterministic and overlapping stock-days are not a portfolio',()=>{
 const first=study(),second=study(),all=group(first);
 assert.ok(all.labelledStockDays>all.distinctDates);
 assert.deepEqual(all.uncertainty,group(second).uncertainty);
 assert.equal(all.uncertainty.rawReturn.state,'exploratory_date_block_interval');
 assert.equal(all.uncertainty.rawReturn.signalDates,all.distinctDates);
 assert.equal(first.actualTradingReturn,null);assert.equal(first.portfolioMaxDrawdown,null);
 assert.equal(first.targetBeforeStop,null);assert.equal(resultAt(first).outcome.actualTradeReturn,null);
 const cost=all.hypotheticalCostScenarios;
 assert.deepEqual(cost.map(x=>x.roundTripBps),[0,30,60]);
 assert.ok(cost.every(x=>x.executable===false));
 assert.ok(cost[2].dailyEqualWeightMeanAssumedReturn<cost[1].dailyEqualWeightMeanAssumedReturn);
 assert.ok(cost[1].dailyEqualWeightMeanAssumedReturn<cost[0].dailyEqualWeightMeanAssumedReturn);
});
test('short sample retains estimates but declines an uncertainty interval',()=>{
 const short={...protocol,validationThrough:'2025-01-10',requestThrough:'2025-01-10'};
 const report=study({protocol:short}),all=group(report);
 assert.ok(all.labelledStockDays>0);assert.ok(all.distinctDates<20);
 assert.equal(all.uncertainty.rawReturn.low,null);
 assert.equal(all.uncertainty.rawReturn.high,null);
});
test('duplicate sources, malformed calendar, mutable protocol and test-window downloads are refused',()=>{
 assert.throws(()=>study({series:[stock(),stock()]}),/duplicate source/);
 assert.throws(()=>study({calendar:{...calendar,sessions:[day,day]}}),/calendar sessions/);
 assert.throws(()=>study({protocol:{...protocol,approved:true}}),/unapproved/);
 assert.throws(()=>study({protocol:{...protocol,rules:['chosen_after_outcomes']}}),/fixed rule/);
 assert.throws(()=>study({protocol:{...protocol,requestThrough:'2026-12-31'}}),/sealed test/);
 assert.throws(()=>study({reconstructedAt:'historical prediction'}),/reconstruction time/);
});
test('research never mutates input histories or frozen protocol',()=>{
 const series=[stock(),make('BBB.SZ'),index()],before=JSON.stringify({series,protocol});
 study({series});assert.equal(JSON.stringify({series,protocol}),before);
});

test('unfinished bars cannot be relabelled complete by the reconstruction adapter',()=>{
 const data=stock();data.rows.find(r=>r.date===day).complete=false;
 assert.throws(()=>historyAsOf(data,day,calendar.sessions),/未完成/);
});
test('the prior-trend contrast measures only the period before the recent 20-session window',()=>{
 const data=stock(),position=data.rows.findIndex(r=>r.date===day);
 for(let j=0;j<60;j++){
  const row=data.rows[position-59+j],close=j<40?180-j*.3:160+(j-40)*2;
  Object.assign(row,{open:close,close,high:close+1,low:close-1});
 }
 const observation=observeRules(data,day,calendar.sessions);
 assert.equal(observation.evidence.priorTrend,false);
 assert.equal(observation.rules.legacy_with_prior_trend,false);
 const changed=clone(data);
 for(let j=0;j<20;j++){
  const row=changed.rows[position-19+j],close=170+j*3;
  Object.assign(row,{open:close,close,high:close+1,low:close-1});
 }
 assert.equal(observeRules(changed,day,calendar.sessions).evidence.priorTrend,false);
});

test('zero-cost uses exactly the same date weighting as the primary gross mean',()=>{
 const data=make('BBB.SZ'),start='2025-02-03';
 for(const row of data.rows)if(row.date<start)row.volume=null;
 const report=study({series:[stock(),data,index()]}),all=group(report);
 assert.ok(Math.abs(all.hypotheticalCostScenarios[0].dailyEqualWeightMeanAssumedReturn-all.dailyEqualWeightMeanPriceReturn)<1e-14);
 const labels=report.ledger.filter(r=>r.rules?.all_readable&&r.state==='price_label_only');
 const expected=labels.reduce((sum,r)=>sum+r.outcome.rawReturn,0)/labels.length;
 assert.ok(Math.abs(all.hypotheticalCostScenarios[0].stockDayMeanAssumedReturn-expected)<1e-14);
});

test('incomplete stock-day coverage and unverified historic quote scale are explicit',()=>{
 const data=stock();data.rows.find(r=>r.date===day).volume=null;
 const report=study({series:[data,make('BBB.SZ'),index()]});
 assert.equal(report.status,'partial_exploratory_study');
 assert.ok(report.coverage.featureCoverage<1);assert.ok(report.coverage.priceLabelCoverage<1);
 assert.equal(report.historicalQuoteScaleVerified,false);
 assert.ok(report.limitations.some(s=>s.includes('未来拆股')));
});
