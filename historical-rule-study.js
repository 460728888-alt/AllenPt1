import crypto from 'node:crypto';
import {assertWindow} from './data-contract.js';
import {analyzeVolumeStructure} from './volume-structure.js';
import {buildVolumeScreenProfile} from './volume-screen.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v),mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ensure=(v,m)=>{if(!v)throw Error(m)};
const dateAt=time=>new Date(time*1000+8*3600000).toISOString().slice(0,10);
const RULE_IDS=['all_readable','simple_trend','legacy_observation','legacy_with_prior_trend','price_trigger_only'];
const validBar=b=>b&&b.complete!==false&&!b.missingSession&&['open','high','low','close'].every(k=>finite(b[k])&&b[k]>0)&&
 b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close,b.high);
export function parseHistory(result,symbol,protocol){
 ensure(result?.meta?.symbol===symbol,'provider symbol mismatch');
 ensure(Array.isArray(result.timestamp)&&result.indicators?.quote?.[0],'provider history format missing');
 const q=result.indicators.quote[0],adj=result.indicators.adjclose?.[0]?.adjclose,rows=[],seen=new Set();
 for(let i=0;i<result.timestamp.length;i++){
  const time=result.timestamp[i];ensure(finite(time)&&time>0,'invalid bar timestamp');
  const date=dateAt(time);
  ensure(date>=protocol.requestFrom&&date<=protocol.requestThrough,'provider returned dates outside frozen request window');
  ensure(!seen.has(date),'duplicate provider session');seen.add(date);
  const close=q.close?.[i],adjusted=adj?.[i];
  rows.push({date,open:q.open?.[i]??null,high:q.high?.[i]??null,low:q.low?.[i]??null,close:close??null,
   volume:q.volume?.[i]??null,adjustmentFactor:finite(close)&&close>0&&finite(adjusted)&&adjusted>0?adjusted/close:null});
 }
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 const actions=[];
 for(const [type,events]of Object.entries(result.events||{})){
  if(!['dividends','splits','capitalGains'].includes(type))continue;
  for(const event of Object.values(events||{})){
   ensure(finite(event.date),'corporate action date missing');
   const date=dateAt(event.date);if(date>=protocol.requestFrom&&date<=protocol.requestThrough)actions.push({type,date});
  }
 }
 return {symbol,rows,actions};
}
export function historyAsOf(series,asOf,sessions,count=60){
 ensure(sessions.includes(asOf),'decision_session_not_in_calendar');
 const dates=sessions.filter(d=>d<=asOf).slice(-count);
 ensure(dates.length===count,'history_too_short');
 const byDate=new Map(series.rows.map(row=>[row.date,row]));
 ensure(byDate.size===series.rows.length,'duplicate_historical_session');
 const selected=dates.map(date=>byDate.get(date));
 ensure(selected.every(row=>row),'missing_historical_session');
 const anchor=selected.at(-1).adjustmentFactor;
 ensure(finite(anchor)&&anchor>0&&selected.every(r=>finite(r.adjustmentFactor)&&r.adjustmentFactor>0),'adjustment_factor_missing');
 ensure(!(series.actions||[]).some(a=>a.type==='splits'&&a.date>=dates[0]&&a.date<=asOf),'split_volume_basis_unverified');
 const rows=selected.map(row=>{
  const scale=row.adjustmentFactor/anchor;
  return {...row,...Object.fromEntries(['open','high','low','close'].map(k=>[k,finite(row[k])?row[k]*scale:null])),complete:row.complete!==false};
 });
 assertWindow(rows,count);
 return rows;
}
export function observeRules(series,asOf,sessions){
 const rows=historyAsOf(series,asOf,sessions),structure=analyzeVolumeStructure(rows),profile=buildVolumeScreenProfile(rows,structure);
 const prior=rows.slice(0,40),first=mean(prior.slice(0,20).map(r=>r.close)),last=mean(prior.slice(20).map(r=>r.close));
 const priorTrend=last>first&&prior.at(-1).close>prior[0].close;
 const legacy=profile.usefulPullback&&profile.volumeDriedUp&&profile.priceTight&&profile.lowsStoppedFalling;
 const ma20=mean(rows.slice(-20).map(r=>r.close)),ma60=mean(rows.map(r=>r.close));
 return {rules:{all_readable:true,simple_trend:rows.at(-1).close>ma20&&ma20>ma60,
   legacy_observation:legacy,legacy_with_prior_trend:legacy&&priorTrend,
   price_trigger_only:structure.stage==='向上突破待确认'},
  featureHash:hash(rows),evidence:{priorTrend,profile:{...profile,levels:{...profile.levels,priceBasis:'reconstructed_provider_quote_anchor'}},rawStage:structure.stage},
  dataThrough:asOf};
}
function label(series,benchmark,dates){
 const selected=dates.map(d=>series.rows.find(r=>r.date===d));
 if(selected.some(row=>!validBar(row)||!finite(row.volume)||row.volume<=0))return {state:'unavailable',reason:'future_price_or_volume_unavailable'};
 if((series.actions||[]).some(a=>a.date>=dates[0]&&a.date<=dates.at(-1)))return {state:'unavailable',reason:'label_window_corporate_action'};
 const first=selected[0].open,last=selected.at(-1).close,rawReturn=last/first-1;
 let benchmarkReturn=null;
 if(benchmark){
  const b=dates.map(d=>benchmark.rows.find(r=>r.date===d));
  if(b.every(validBar)&&!(benchmark.actions||[]).some(a=>a.date>=dates[0]&&a.date<=dates.at(-1)))
   benchmarkReturn=b.at(-1).close/b[0].open-1;
 }
 return {state:'price_label_only',entryPrice:first,exitPrice:last,rawReturn,
  benchmarkReturn,excess:benchmarkReturn===null?null:rawReturn-benchmarkReturn,
  positive:rawReturn>0,adversePriceExcursion:Math.min(...selected.map(r=>r.low))/first-1,
  execution:'unknown_no_verified_tradability',actualTradeReturn:null};
}
function bootstrap(byDate,calendar,cfg,field){
 const values=new Map(byDate.map(row=>[row.date,row[field]])),signalDates=byDate.filter(r=>finite(r[field])).length;
 if(signalDates<cfg.minSignalDates)return {state:'insufficient_dates',signalDates,low:null,high:null};
 let seed=cfg.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 const draws=[];
 for(let rep=0;rep<cfg.replicates;rep++){
  const selected=[];
  for(let n=0;n<calendar.length;n+=cfg.blockSessions){
   const start=Math.floor(random()*calendar.length);
   for(let j=0;j<cfg.blockSessions&&n+j<calendar.length;j++){
    const value=values.get(calendar[(start+j)%calendar.length]);if(finite(value))selected.push(value);
   }
  }
  const value=mean(selected);if(value!==null)draws.push(value);
 }
 draws.sort((a,b)=>a-b);
 return {state:'exploratory_date_block_interval',signalDates,replicates:draws.length,
  low:draws.length?draws[Math.floor((draws.length-1)*.025)]:null,
  high:draws.length?draws[Math.floor((draws.length-1)*.975)]:null};
}
export function runRuleStudy({protocol,calendar,series,downloads=[],reconstructedAt,sourceCommit=null}){
 ensure(protocol.provenance==='reconstructed'&&protocol.observationOnly===true,'reconstruction-only protocol required');
 ensure(protocol.approved===false&&protocol.entryRule==='next_session_open'&&protocol.exitRule==='fifth_session_close','unapproved price-label study only');
 ensure(JSON.stringify(protocol.rules)===JSON.stringify(RULE_IDS),'fixed rule groups required');
 ensure(JSON.stringify(protocol.costScenarioBps)==='[0,30,60]','fixed hypothetical cost scenarios required');
 ensure(protocol.bootstrap?.unit==='calendar_date_equal_weight'&&protocol.bootstrap.blockSessions===10&&
  protocol.bootstrap.replicates===400&&protocol.bootstrap.minSignalDates===20&&Number.isSafeInteger(protocol.bootstrap.seed),'fixed block-bootstrap protocol required');
 ensure(protocol.requestFrom<=protocol.validationFrom&&protocol.validationFrom<=protocol.validationThrough,'invalid study date order');
 ensure(calendar.sessions.length&&calendar.sessions.every((date,i)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&date>=calendar.validFrom&&date<=calendar.validThrough&&(!i||date>calendar.sessions[i-1])),'invalid reviewed calendar sessions');
 ensure(new Set(series.map(s=>s.symbol)).size===series.length,'duplicate source symbol');
 ensure(typeof reconstructedAt==='string'&&Number.isFinite(Date.parse(reconstructedAt)),'actual reconstruction time required');
 ensure(protocol.historySessions===60&&protocol.horizonSessions===5,'frozen 60/5 session windows required');
 ensure(protocol.requestThrough===protocol.validationThrough&&protocol.validationThrough<protocol.sealedTestFrom,'sealed test must not be requested');
 ensure(calendar.validFrom<=protocol.requestFrom&&calendar.validThrough>=protocol.validationThrough,'reviewed calendar coverage missing');
 ensure(protocol.universe.length&&new Set(protocol.universe.map(r=>r.symbol)).size===protocol.universe.length,'fixed unique universe required');
 const validation=calendar.sessions.filter(d=>d>=protocol.validationFrom&&d<=protocol.validationThrough),lookup=new Map(series.map(s=>[s.symbol,s]));
 const benchmark=lookup.get(protocol.benchmark),ledger=[],exclusions={};
 const count=reason=>{exclusions[reason]=(exclusions[reason]||0)+1};
 for(const {symbol}of protocol.universe){
  const data=lookup.get(symbol);
  for(const date of validation){
   const index=calendar.sessions.indexOf(date),future=calendar.sessions.slice(index+1,index+6);
   const base={symbol,decisionAsOf:date+'T16:00:00+08:00',dataThrough:date,
    provenance:'reconstructed',reconstructedAt,entryDate:future[0],labelThrough:future.at(-1)};
   if(future.length!==5||future.at(-1)>protocol.validationThrough){ledger.push({...base,state:'purged_boundary'});continue}
   if(!data){count('source_unavailable');ledger.push({...base,state:'source_unavailable'});continue}
   let observation;
   try{observation=observeRules(data,date,calendar.sessions)}
   catch(error){const reason=String(error.message);count(reason);ledger.push({...base,state:'features_unavailable',reason});continue}
   const outcome=label(data,benchmark,future);
   if(outcome.state==='unavailable')count(outcome.reason);
   ledger.push({...base,state:outcome.state,rules:observation.rules,featureHash:observation.featureHash,
    evidence:observation.evidence,outcome});
  }
 }
 const valid=ledger.filter(r=>r.state==='price_label_only'),baseDates=new Map();
 for(const date of validation)baseDates.set(date,mean(valid.filter(r=>r.dataThrough===date).map(r=>r.outcome.rawReturn)));
 const groups=protocol.rules.map(id=>{
  const signals=ledger.filter(row=>row.rules?.[id]),labelled=signals.filter(row=>row.state==='price_label_only');
  const daily=[...new Set(labelled.map(r=>r.dataThrough))].sort().map(date=>{
   const records=labelled.filter(r=>r.dataThrough===date),raw=mean(records.map(r=>r.outcome.rawReturn));
   return {date,n:records.length,rawReturn:raw,benchmarkExcess:mean(records.map(r=>r.outcome.excess).filter(finite)),
    sameDateUniverseExcess:baseDates.get(date)===null?null:raw-baseDates.get(date),
    positivePriceFraction:mean(records.map(r=>r.outcome.positive?1:0))};
  });
  return {id,signalStockDays:signals.length,labelledStockDays:labelled.length,labelMissing:signals.length-labelled.length,
   distinctDates:daily.length,distinctSymbols:new Set(labelled.map(r=>r.symbol)).size,
   grossPositivePriceFraction:mean(labelled.map(r=>r.outcome.positive?1:0)),
   dailyEqualWeightMeanPriceReturn:mean(daily.map(r=>r.rawReturn)),
   dailyEqualWeightMeanIndexExcess:mean(daily.map(r=>r.benchmarkExcess).filter(finite)),
   dailyEqualWeightMeanSampleExcess:mean(daily.map(r=>r.sameDateUniverseExcess).filter(finite)),
   uncertainty:{rawReturn:bootstrap(daily,validation,protocol.bootstrap,'rawReturn'),
    sampleExcess:bootstrap(daily,validation,protocol.bootstrap,'sameDateUniverseExcess')},
   hypotheticalCostScenarios:protocol.costScenarioBps.map(bps=>({roundTripBps:bps,executable:false,
    meanAssumedReturn:mean(labelled.map(r=>r.outcome.exitPrice*(1-bps/20000)/(r.outcome.entryPrice*(1+bps/20000))-1))})),
   quarters:[1,2,3,4].map(q=>{const list=daily.filter(r=>Math.floor((Number(r.date.slice(5,7))-1)/3)+1===q);
    return {quarter:q,dates:list.length,meanPriceReturn:mean(list.map(r=>r.rawReturn)),meanSampleExcess:mean(list.map(r=>r.sameDateUniverseExcess).filter(finite))}}),
   daily};
 });
 const sourceSuccess=protocol.universe.filter(r=>lookup.has(r.symbol)).length;
 const benchmarkLabels=valid.filter(row=>finite(row.outcome.benchmarkReturn)).length;
 return {version:'five-session-reconstruction-1',protocolId:protocol.id,protocolSha256:hash(protocol),
  sourceCommit,reconstructedAt,provenance:'reconstructed',dataKind:'historical_provider_data',approved:false,
  status:!sourceSuccess?'unable_to_study':!valid.length?'insufficient_labels':sourceSuccess<protocol.universe.length||benchmarkLabels<valid.length?'partial_exploratory_study':'exploratory_price_study',
  winner:null,liveStrategyChanged:false,probabilitiesEnabled:false,
  coverage:{requestedStocks:protocol.universe.length,receivedStocks:sourceSuccess,failedStocks:protocol.universe.length-sourceSuccess,
   benchmarkAvailable:!!benchmark,benchmarkPriceLabels:benchmarkLabels,missingBenchmarkLabels:valid.length-benchmarkLabels,submittedStockDays:ledger.length,featureReadable:ledger.filter(r=>r.rules).length,
   validPriceLabels:valid.length,purgedBoundary:ledger.filter(r=>r.state==='purged_boundary').length,exclusionReasons:exclusions},
  definitions:{target:'次交易日开盘至第5交易日收盘的提供方价格变化；不是当时预测或交易胜率',
   legacy:'原观察条件，未包含完整先前上涨和阶段顺序；不使用不兼容的合格候选门槛',
   priorTrend:'仅在回调窗口之前40根日线内：后20根均价高于前20根，且末收盘高于首收盘；研究对照，不是正式策略',
   simpleTrend:'当时收盘>MA20且MA20>MA60；固定简单对照',
   sampleBasis:'仓库当前固定A股名单，非当时全市场；含幸存者与选择偏差',
   uncertainty:'按官方交易日作10日移动块重采样，日期内等权，探索性区间；不证明未来优势'},
  groups,downloads,ledger,actualTradingReturn:null,portfolioMaxDrawdown:null,targetBeforeStop:null,
  limitations:['事后重建，不声称历史当时生成过预测；历史数据可能修订，无法证明严格未参与开发的样本',
   '只请求2024—2025日线，2026测试区未评估；规则与名单不根据本次结果调整',
   '当前名单不是无偏历史股票池，上市退市、停牌及板块状态不完整',
   'Yahoo价格尺度与公司行动未经独立交易所核验；特征按虚拟观察日复权锚点重建，标签含公司行动窗口排除',
   '股票日信号重叠且相关，不能把行数当独立样本数；未模拟资金、仓位及真实组合',
   '没有可靠成交标记；成本为假设可成交的比例费率情景，不含最低佣金、税差、实际滑点与冲击',
   '固定五日价格研究不执行结构失效或交易止损，不能据此报告止盈止损先后或组合回撤']};
}
