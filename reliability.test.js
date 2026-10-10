import test from 'node:test';
import assert from 'node:assert/strict';
import {finiteNumber,normalizeDailyChart,assertWindow,calendarExpectation} from './data-contract.js';
import {mapLimit} from './opportunity.js';
import {priceLevels,netRiskReward,tradePlanFromLevels,SCREEN_STRATEGY} from './price-levels.js';
import {analyzeVolumeStructure} from './volume-structure.js';
import {buildVolumeScreenProfile,classifyVolumeCandidate} from './volume-screen.js';
import {scanVolumeStocks} from './volume-scan.js';
import {probabilityEligibility,guardForecast} from './probability-contract.js';
import {committeeDecision} from './forecast-client.js';
import {createResearchStore,snapshotHash} from './research-store.js';

const dates=Array.from({length:80},(_,i)=>new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10));
// Synthetic calendar is only test input; it is NOT a real exchange calendar.
const calendar={source:'synthetic-test-only',validFrom:dates[0],validThrough:'2026-12-31',sessions:dates};
const now=new Date(dates.at(-1)+'T08:00:00Z');
function rows() {return dates.map((date,i)=>({date,time:Date.parse(date+'T01:30:00Z')/1000,complete:true,open:11.5,high:12,low:11,close:11.5,volume:i<75?1000:700,adjustmentFactor:1,scaleFactor:1}));}
function chart(input=rows()) {return {timestamp:input.map(r=>r.time),indicators:{quote:[Object.fromEntries(['open','high','low','close','volume'].map(k=>[k,input.map(r=>r[k])]))],adjclose:[{adjclose:input.map(r=>r.close)}]}};}
const normalize=(c,opts={})=>normalizeDailyChart(c,{symbol:'600001.SS',calendar,now,...opts});

test('missing numeric values stay null; explicit zero stays zero',()=>{
  for(const v of [null,undefined,'',' ',false,true,[],{},NaN,Infinity])assert.equal(finiteNumber(v),null);
  assert.equal(finiteNumber(0),0);assert.equal(finiteNumber('12.5'),12.5);
});
test('missing or zero volumes cannot count as drying up',()=>{
  for(const value of [null,undefined,'',0]){
    const r=rows();r.at(-8).volume=value;
    assert.throws(()=>analyzeVolumeStructure(r));assert.throws(()=>buildVolumeScreenProfile(r,{}));
    assert.notEqual(normalize(chart(r)).data.state,'ok');
  }
});
test('missing session remains in the window rather than stitching older days',()=>{
  const r=rows();r.splice(-5,1);const normalized=normalize(chart(r));
  assert.equal(normalized.rows.length,80);assert.ok(normalized.rows.some(r=>r.missingSession));assert.equal(normalized.data.state,'insufficient');
});
test('no calendar means freshness is unknown, never fabricated weekdays',()=>{
  assert.equal(normalize(chart(),{calendar:null}).data.state,'insufficient');
  assert.equal(calendarExpectation({...calendar,validThrough:'2025-01-01'},now).verified,false);
});
test('holiday and incomplete current bar use last completed calendar session',()=>{
  const holiday=new Date(Date.parse(now)+86400000),r=normalize(chart(),{now:holiday});assert.equal(r.data.state,'ok');
  const intraday=normalize(chart(),{now:new Date(dates.at(-1)+'T03:00:00Z')});
  assert.equal(intraday.data.unfinishedBars,1);assert.equal(intraday.data.dataThrough,dates.at(-2));assert.equal(intraday.data.state,'ok');
});
test('stale source, missing factors and split-volume uncertainty suspend calculation',()=>{
  assert.equal(normalize(chart(rows().slice(0,-1))).data.state,'stale');
  const c=chart();delete c.indicators.adjclose;assert.equal(normalize(c).data.state,'insufficient');
  const split=chart();split.events={splits:{test:{date:rows().at(-5).time}}};assert.equal(normalize(split).data.state,'insufficient');
});
test('adjusted prices reanchor to last completed raw price and preserve factors',()=>{
  const c=chart();c.indicators.adjclose[0].adjclose=c.indicators.adjclose[0].adjclose.map((p,i)=>p*(i<40?.5:.8));
  const n=normalize(c);assert.equal(n.rows.at(-1).close,11.5);assert.equal(n.rows[0].close,11.5*.5/.8);assert.equal(n.data.anchorFactor,.8);
});
test('the judgment bar is excluded from range; outward tick rounding precedes RR',()=>{
  const r=rows();r.at(-1).high=200;
  const p=priceLevels(r);assert.equal(p.upper,12);assert.equal(p.lower,11);assert.equal(p.entry,12.04);assert.equal(p.stop,10.96);
  assert.equal(p.target1,13);assert.equal(p.target2,14);assert.ok(Math.abs(p.rr1-.88888888888889)<1e-12);assert.ok(p.rr2<2);
});
test('invalid price relationships and missing prices produce no denominator floor',()=>{
  for(const edit of [r=>{for(const b of r)Object.assign(b,{high:11.5,low:11.5})},r=>r.at(-2).high=null]){
    const r=rows();edit(r);const p=priceLevels(r);assert.equal(p.state,'unavailable');assert.equal(p.rr1,null);
  }
  assert.equal(priceLevels(rows(),{planType:'pullback'}).state,'unavailable');
  assert.equal(priceLevels(rows(),{planType:'pullback',entry:10}).state,'unavailable');
});
test('cost does not move structure targets, every surface gets identical levels',()=>{
  const r=rows(),levels=priceLevels(r),structure=analyzeVolumeStructure(r),profile=buildVolumeScreenProfile(r,structure);
  const stock={symbol:'600001.SS',history:r,levels,data:{state:'ok'}};
  const first=tradePlanFromLevels(stock,{cost:1,qty:100}),second=tradePlanFromLevels(stock,{cost:200,qty:100});
  for(const p of [structure.levels,profile.levels,first.levels,second.levels])assert.deepEqual(p,levels);
  assert.equal(first.target1,second.target1);assert.equal(first.riskBudget,null);
});
test('close invalidation does not wait for high volume',()=>{
  const r=rows();Object.assign(r.at(-1),{open:10.9,close:10.9,low:10.8,high:11,volume:5});
  assert.equal(analyzeVolumeStructure(r).stage,'结构失效');
});
test('T1 compatibility is explicit, T2 and rounded display never create green eligibility',()=>{
  assert.equal(SCREEN_STRATEGY.qualified,null);assert.equal(SCREEN_STRATEGY.t2Enabled,false);
  for(const rr of [.9999,1.4999999,1.5,2,100])assert.equal(classifyVolumeCandidate({stage:'向上突破待确认'},{usefulPullback:true,riskReward:rr}),null);
  assert.equal(classifyVolumeCandidate({stage:'横盘蓄势'},{usefulPullback:true,volumeDriedUp:true,priceTight:true,lowsStoppedFalling:true}).tone,'yellow');
});
test('fees require all inputs; net outcome includes commissions at both exits',()=>{
  const p=priceLevels(rows());assert.equal(netRiskReward(p,100,null).state,'unavailable');
  const net=netRiskReward(p,100,{commissionRatePer10000:2.5,minimumCommission:5,stampDutyRatePer10000:5,transferFeeRatePer10000:.1});
  assert.ok(net.rr1<p.rr1);assert.ok(net.risk>100*(p.entry-p.stop));
});
test('request reason survives concurrency and all failure means unable to judge',async()=>{
  const list=[{symbol:'one'},{symbol:'two'}];
  const result=await scanVolumeStocks(list,{quote:async()=>{throw new DOMException('timeout','TimeoutError')}});
  assert.equal(result.coverage.returned,0);assert.equal(result.coverage.failed,2);assert.equal(result.coverage.usable,0);
  assert.equal(result.coverage.state,'unable_to_judge');assert.equal(result.counts.qualified,null);
  assert.equal(result.coverage.reasons.timeout,2);assert.match(result.message,/无法完成判断/);
});
test('partial responses distinguish failure from insufficient and count non-candidates as usable',async()=>{
  const list=['one','two','three','four'].map(symbol=>({symbol}));
  const result=await scanVolumeStocks(list,{quote:async symbol=>{
    if(symbol==='one')throw Error('upstream 503');
    if(symbol==='two')return {data:{state:'insufficient',reasons:['历史不足']}};
    return {symbol,name:symbol,history:rows(),data:{state:'ok',dataThrough:dates.at(-1)}};
  }});
  assert.equal(result.coverage.returned,3);assert.equal(result.coverage.failed,1);assert.equal(result.coverage.insufficient,1);
  assert.equal(result.coverage.usable,2);assert.equal(result.coverage.coveragePct,50);assert.equal(result.audit.length,4);
});
test('old invalidation condition remains fixed on fresh observations',async()=>{
  const result=await scanVolumeStocks([{symbol:'one'}],{tracked:[{symbol:'one',original:{dataThrough:dates[0],levels:{stop:11.6}}}],quote:async()=>({symbol:'one',history:rows(),data:{state:'ok',dataThrough:dates.at(-1)}})});
  assert.equal(result.items[0].tone,'red');assert.equal(result.items[0].giveUpPrice,11.6);
});
const contract=target=>({target,days:20,startRule:'completed_close',endRule:'20th_completed_close',feeBasis:'net_20bp',benchmark:target==='outperform'?'SSE_COMPOSITE':undefined,
  validation:{approved:true,method:'held-out-calibration',sampleSize:200,evidenceRef:'test-fixture-only',evaluatedThrough:'2026-01-01',validUntil:'2099-01-01'}});
test('unverified, out of range, null and stale probabilities are blocked',()=>{
  for(const v of [null,'',-1,101,Infinity])assert.equal(probabilityEligibility(v,contract('up')).value,null);
  assert.equal(probabilityEligibility(70,{}).eligible,false);
  const stale=contract('up');stale.validation.validUntil='2020-01-01';assert.equal(probabilityEligibility(70,stale).state,'stale');
  assert.equal(guardForecast({upProbability:75}).upProbability,null);
});
test('verified but different targets cannot form model resonance',()=>{
  const r=committeeDecision({outperformProbability:70,probabilityContracts:{outperformProbability:contract('outperform')}},{upProbability:70,probabilityContracts:{upProbability:contract('up')}});
  assert.equal(r.agreement,false);assert.match(r.status,/目标不同/);
});
test('disabled persistence rejects reads and writes, no memory fallback',async()=>{
  const store=createResearchStore(null,{enabled:true});
  await assert.rejects(store.list(1),/未启用/);await assert.rejects(store.saveVolumeScan(1,{}),/未启用/);
});
test('canonical snapshot hashes ignore key order but detect changed conditions',()=>{
  assert.equal(snapshotHash({a:1,b:{x:2}}),snapshotHash({b:{x:2},a:1}));
  assert.notEqual(snapshotHash({stop:10}),snapshotHash({stop:11}));
});


test('corporate actions prevent comparing new raw close with old raw stop',async()=>{
 const result=await scanVolumeStocks([{symbol:'one'}],{tracked:[{symbol:'one',original:{dataThrough:dates[0],levels:{stop:11.6}}}],quote:async()=>({symbol:'one',history:rows(),data:{state:'ok',dataThrough:dates.at(-1),corporateActions:[{type:'dividends',date:dates[40]}]}})});
 assert.equal(result.items[0].originalInvalid,false);assert.equal(result.items[0].originalComparable,false);assert.equal(result.items[0].tone,'orange');
});
test('guard rejects mislabeled probability contracts',()=>{
 const r=guardForecast({upProbability:65,probabilityContracts:{upProbability:contract('outperform')}});assert.equal(r.upProbability,null);
});

test('a moving current range cannot invalidate an unbroken original stop',async()=>{
 const r=rows();Object.assign(r.at(-1),{open:10.9,close:10.9,high:11,low:10.8});
 const result=await scanVolumeStocks([{symbol:'one'}],{tracked:[{symbol:'one',original:{dataThrough:dates[0],levels:{stop:10}}}],quote:async()=>({symbol:'one',history:r,data:{state:'ok',dataThrough:dates.at(-1)}})});
 assert.equal(result.items[0].originalInvalid,false);assert.equal(result.items[0].tone,'orange');assert.equal(result.items[0].giveUpPrice,10);
});
