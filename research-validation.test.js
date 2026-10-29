import test from 'node:test';
import assert from 'node:assert/strict';
import {validationFixture} from './tests/fixtures/validation.mjs';
import {evaluateResearch,buildPriceCases,purgedSplit,protocolHash,datasetHash,wilson} from './research-validation.js';
const clone=v=>JSON.parse(JSON.stringify(v));
test('synthetic output is never approved, never selects a model, and keeps three targets separate',()=>{
 const report=evaluateResearch(validationFixture());
 assert.equal(report.approved,false);assert.equal(report.modelSelected,null);assert.equal(report.status,'framework_test_only');
 assert.deepEqual(Object.keys(report.targets),['up','outperform','target_before_stop']);
 assert.equal(report.targets.target_before_stop.labelled,0);
 assert.equal(report.execution.portfolioMaxDrawdown,null);
});
test('time partitions purge all labels crossing the next held-out boundary',()=>{
 const input=validationFixture(),cases=buildPriceCases(input),split=purgedSplit(cases,input.protocol,input.sessions);
 const start=input.sessions[input.sessions.indexOf(input.protocol.split.validationEnd)+2];
 assert.ok(split.validation.every(c=>c.labelThrough<start));
 assert.ok(split.purged.length>0);
});
test('future feature availability and late generation are excluded, never silently relabelled',()=>{
 const input=validationFixture(),record=input.records[20];
 record.featureAvailableAt=input.sessions[21]+'T16:00:00+08:00';
 let row=buildPriceCases(input).find(c=>c.id===record.id);
 assert.equal(row.reason,'missing_or_future_feature_provenance');
 record.featureAvailableAt=record.dataThrough+'T15:05:00+08:00';
 record.generatedAt=input.sessions[21]+'T10:00:00+08:00';
 row=buildPriceCases(input).find(c=>c.id===record.id);
 assert.equal(row.reason,'prediction_generated_after_entry');
});
test('a complete daily bar cannot be used before the reviewed close boundary',()=>{
 const input=validationFixture(),record=input.records[20];
 record.featureAvailableAt=record.dataThrough+'T14:00:00+08:00';record.generatedAt=record.dataThrough+'T14:30:00+08:00';
 assert.equal(buildPriceCases(input).find(c=>c.id===record.id).reason,'complete_daily_bar_not_available_at_generation');
});
test('a missing exchange session cannot compress the nominal five-session label horizon',()=>{
 const input=validationFixture(),record=input.records[20],date=input.sessions[22];
 input.bars=input.bars.filter(bar=>!(bar.symbol===record.symbol&&bar.date===date));
 assert.equal(buildPriceCases(input).find(c=>c.id===record.id).reason,'missing_or_invalid_session_bar');
});
test('price-basis and corporate-action uncertainty exclude samples with a public reason',()=>{
 const input=validationFixture();delete input.bars.find(b=>b.symbol==='SYNTHETIC-A'&&b.date===input.sessions[22]).corporateAction;
 assert.ok(buildPriceCases(input).some(c=>c.reason==='corporate_action_or_price_basis_unverified'));
});
test('unfilled and unresolved exits remain in the ledger and cannot become net profits',()=>{
 const input=validationFixture(),entry=input.bars.find(b=>b.symbol==='SYNTHETIC-A'&&b.date===input.sessions[21]);
 entry.canBuyOpen=false;
 let c=buildPriceCases(input).find(c=>c.id==='SYNTHETIC-20');
 assert.equal(c.execution.state,'unfilled');assert.equal(c.execution.netReturn,null);
 entry.canBuyOpen=true;
 const exit=input.bars.find(b=>b.symbol==='SYNTHETIC-A'&&b.date===input.sessions[25]);exit.canSellClose=false;
 c=buildPriceCases(input).find(c=>c.id==='SYNTHETIC-20');
 assert.equal(c.labelThrough,input.sessions[25]);assert.equal(c.execution.state,'exit_unresolved');assert.equal(c.actualExit,null);
});
test('unknown execution flags are not guessed true',()=>{
 const input=validationFixture();delete input.bars.find(b=>b.symbol==='SYNTHETIC-A'&&b.date===input.sessions[21]).canBuyOpen;
 const c=buildPriceCases(input).find(c=>c.id==='SYNTHETIC-20');
 assert.equal(c.execution.state,'entry_execution_unknown');assert.equal(c.execution.netReturn,null);
});
test('explicit slippage and costs use entry plus buy cost and exit minus sell cost',()=>{
 const input=validationFixture(),c=buildPriceCases(input).find(c=>c.id==='SYNTHETIC-20');
 const first=input.bars.find(b=>b.symbol===c.symbol&&b.date===c.entryDate),last=input.bars.find(b=>b.symbol===c.symbol&&b.date===c.labelThrough);
 const expected=last.close*.9995*.999/(first.open*1.0005*1.0005)-1;
 assert.ok(Math.abs(c.execution.netReturn-expected)<1e-12);
});
test('percent 0.8 remains 0.8 percent, never guessed to mean 80 percent',()=>{
 const input=validationFixture();
 for(const record of input.records)record.forecasts.synthetic_A.up.value=.8;
 const r=evaluateResearch(input).targets.up.models.find(m=>m.name==='synthetic_A');
 assert.ok(Math.abs(r.calibration[0].meanProbability-.008)<1e-12);
});
test('expired, missing or mismatched-horizon probabilities count as abstention',()=>{
 const input=validationFixture();
 for(const record of input.records){record.forecasts.synthetic_A.up.validUntil='2020-01-01T00:00:00Z';record.forecasts.synthetic_B.up.horizonSessions=20}
 const r=evaluateResearch(input).targets.up;
 assert.ok(r.models.every(m=>m.predicted===0&&m.abstained===m.eligible&&m.brier===null));
});
test('future model/calibration cutoffs cannot borrow held-out labels',()=>{
 const input=validationFixture();
 for(const record of input.records)record.forecasts.synthetic_A.up.trainedThrough=input.sessions[25];
 assert.equal(evaluateResearch(input).targets.up.models.find(m=>m.name==='synthetic_A').predicted,0);
});
test('comparisons publish both individual coverage and the common paired sample',()=>{
 const input=validationFixture();delete input.records[20].forecasts.synthetic_B.up;
 const r=evaluateResearch(input).targets.up;
 assert.ok(r.models.find(m=>m.name==='synthetic_A').predicted>r.commonSampleSize);
 assert.ok(r.models.every(m=>m.commonSample.sampleSize===r.commonSampleSize));
});
test('sealed final-test labels and returns are not emitted in a validation ledger',()=>{
 const input=validationFixture(),r=evaluateResearch(input);
 const row=r.ledger.find(c=>c.decisionDate===input.sessions[45]);
 assert.equal(row.state,'sealed_or_outside_selected_partition');assert.equal(row.labels,undefined);
 assert.equal(row.rawReturn,undefined);assert.equal(row.execution,undefined);
 assert.throws(()=>evaluateResearch(input,{partition:'test'}),/sealed/);
 const seal=protocolHash(input.protocol);
 assert.equal(evaluateResearch(input,{partition:'test',allowFinalTest:true,frozenProtocolHash:seal,frozenDatasetHash:datasetHash(input)}).partition,'test');
 const changed=clone(input);changed.protocol.costs.buyBps++;
 assert.throws(()=>evaluateResearch(changed,{partition:'test',allowFinalTest:true,frozenProtocolHash:seal}),/sealed/);
});
test('empty labels and calibration bins remain null with explicit sample counts',()=>{
 const input=validationFixture();input.records=[];
 const r=evaluateResearch(input);assert.equal(r.execution.meanNetScenarioReturn,null);
 assert.equal(r.execution.worstAdversePriceExcursion,null);assert.equal(wilson(0,0),null);
});
test('price labels do not change when costs change and never become stop-first labels',()=>{
 const a=validationFixture(),b=clone(a);b.protocol.costs.sellBps=1000;
 const x=buildPriceCases(a).find(c=>c.id==='SYNTHETIC-20'),y=buildPriceCases(b).find(c=>c.id===x.id);
 assert.deepEqual(x.labels,y.labels);assert.notEqual(x.execution.netReturn,y.execution.netReturn);
 assert.equal(x.labels.target_before_stop,null);
});

test('validation never exposes held-out or purged future data availability through counts or reasons',()=>{
 const input=validationFixture(),changed=clone(input);
 const dates=[input.sessions[46],input.sessions[40]];
 changed.bars=changed.bars.filter(bar=>!(bar.symbol==='SYNTHETIC-A'&&dates.includes(bar.date)));
 const a=evaluateResearch(input),b=evaluateResearch(changed);
 assert.deepEqual(a.counts,b.counts);assert.deepEqual(a.exclusionReasons,b.exclusionReasons);
 assert.deepEqual(a.targets,b.targets);assert.deepEqual(a.ledger,b.ledger);
});
test('missing benchmark affects outperform labels without deleting valid up labels or stock cost scenarios',()=>{
 const input=validationFixture();input.bars=input.bars.filter(b=>!(b.symbol==='SYNTHETIC-INDEX'&&b.date===input.sessions[22]));
 const c=buildPriceCases(input).find(row=>row.id==='SYNTHETIC-20');
 assert.equal(c.state,'labelled');assert.notEqual(c.labels.up,null);assert.equal(c.labels.outperform,null);
 assert.equal(c.execution.state,'cost_scenario');assert.equal(c.execution.benchmarkReturn,null);
 const r=evaluateResearch(input);assert.ok(r.targets.up.labelled>r.targets.outperform.labelled);
});
test('an entire month of abstention stays visible rather than disappearing from period reports',()=>{
 const input=validationFixture();
 for(const record of input.records)if(record.dataThrough.startsWith('2026-02'))delete record.forecasts.synthetic_A.up;
 const r=evaluateResearch(input).targets.up.models.find(m=>m.name==='synthetic_A');
 const month=r.periods.find(p=>p.month==='2026-02');
 assert.ok(month);assert.equal(month.predicted,0);assert.equal(month.accuracy,null);
});
