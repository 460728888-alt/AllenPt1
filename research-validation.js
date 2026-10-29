import crypto from 'node:crypto';
// Offline price-label audit. It never trains/enables a model or changes the live strategy.
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
export const datasetHash=input=>crypto.createHash('sha256').update(canonical(input)).digest('hex');
export const protocolHash=protocol=>crypto.createHash('sha256').update(canonical(protocol)).digest('hex');
export const VALIDATION_VERSION='short-horizon-audit-1';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const stamp=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const targets=['up','outperform','target_before_stop'];
const assert=(value,message)=>{if(!value)throw Error(message)};
const mean=values=>values.length?values.reduce((s,x)=>s+x,0)/values.length:null;
const positive=value=>finite(value)&&value>0;
export function wilson(successes,total){
 if(!total)return null;
 const z=1.95996398454,p=successes/total,d=1+z*z/total,c=(p+z*z/(2*total))/d;
 const h=z*Math.sqrt((p*(1-p)+z*z/(4*total))/total)/d;
 return {low:Math.max(0,c-h),high:Math.min(1,c+h),level:.95};
}
export function validateProtocol(input){
 const p=input?.protocol;
 assert(p&&typeof p.id==='string'&&p.id.trim(),'protocol.id is required');
 assert(['synthetic','historical'].includes(input.dataKind),'dataKind must be explicit');
 assert(input.metadata?.source&&input.metadata?.datasetVersion,'source and datasetVersion are required');
 assert(['point_in_time','current_only','unknown'].includes(input.metadata?.universeBasis),'historical universe basis is required');
 assert(p.market==='CN_A','this pilot supports explicit CN_A sessions only');
 assert(p.priceBasis==='raw_no_corporate_actions','only explicit raw_no_corporate_actions price basis is supported');
 assert(Number.isInteger(p.horizonSessions)&&p.horizonSessions>=2&&p.horizonSessions<=20,'horizonSessions must be 2..20');
 assert(['percent','fraction'].includes(p.probabilityUnit),'probabilityUnit must be percent or fraction; never inferred');
 assert(p.entryRule==='next_session_open'&&p.exitRule==='horizon_session_close','entry/exit definitions are required');
 assert(p.upTarget==='raw_price_return_positive','up target must be raw price return, not net return');
 assert(typeof p.benchmark==='string'&&p.benchmark,'benchmark is required');
 assert(p.sameDayBarrierOrder==='unknown','OHLC cannot establish same-day barrier order');
 assert(p.costs?.mode==='proportional_scenario_no_minimum_commission','costs must explicitly exclude minimum commission');
 for(const key of ['buyBps','sellBps','buySlippageBps','sellSlippageBps'])
  assert(finite(p.costs[key])&&p.costs[key]>=0&&p.costs[key]<10000,'explicit nonnegative cost required: '+key);
 assert(p.tPlusOne===true,'A-share T+1 must be explicit');
 const s=input.sessions;
 assert(Array.isArray(s)&&s.length>0&&s.every((d,i)=>day(d)&&(!i||d>s[i-1])),'sorted unique trading sessions are required');
 const f=p.split;
 assert(f&&[f.trainEnd,f.validationEnd,f.testEnd].every(d=>day(d)&&s.includes(d))&&f.trainEnd<f.validationEnd&&f.validationEnd<f.testEnd,'ordered session split boundaries are required');
 assert(Number.isInteger(f.embargoSessions)&&f.embargoSessions>=0,'embargoSessions must be explicit');
 assert(Array.isArray(input.records)&&Array.isArray(input.bars),'records and bars are required');
 return p;
}
function barValid(bar){
 return bar?.complete===true&&['open','high','low','close'].every(k=>positive(bar[k]))&&
  bar.high>=Math.max(bar.open,bar.close,bar.low)&&bar.low<=Math.min(bar.open,bar.close,bar.high);
}
export function buildPriceCases(input){
 const p=validateProtocol(input),sessions=input.sessions,barMap=new Map(),ids=new Set();
 for(const bar of input.bars){
  assert(typeof bar.symbol==='string'&&day(bar.date),'bar needs symbol/date');
  const key=bar.symbol+'|'+bar.date;assert(!barMap.has(key),'duplicate bar: '+key);barMap.set(key,bar);
 }
 return input.records.map(record=>{
  assert(typeof record.id==='string'&&record.id&&!ids.has(record.id),'unique immutable research IDs required');ids.add(record.id);
  const base={id:record.id,symbol:record.symbol,decisionDate:record.dataThrough,labels:{up:null,outperform:null,target_before_stop:null},
   execution:{state:'unknown',netReturn:null,benchmarkReturn:null,adversePriceExcursion:null},record,reason:null};
  const reject=reason=>({...base,state:'excluded',reason});
  const i=sessions.indexOf(record.dataThrough),window=sessions.slice(i+1,i+1+p.horizonSessions);
  if(i<0||!day(record.featureThrough)||record.featureThrough>record.dataThrough||
    !stamp(record.featureAvailableAt)||!stamp(record.generatedAt)||Date.parse(record.featureAvailableAt)>Date.parse(record.generatedAt)||
    !record.featureSnapshotHash||!record.strategyVersion)return reject('missing_or_future_feature_provenance');
  const entryDate=window[0],labelThrough=window.at(-1);
  if(window.length!==p.horizonSessions)return reject('future_horizon_incomplete');
  const entryAt=Date.parse(entryDate+'T09:30:00+08:00');
  if(Date.parse(record.generatedAt)>=entryAt)return reject('prediction_generated_after_entry');
  const decisionClose=Date.parse(record.dataThrough+'T15:05:00+08:00');
  if(Date.parse(record.featureAvailableAt)<decisionClose||Date.parse(record.generatedAt)<decisionClose)
    return reject('complete_daily_bar_not_available_at_generation');
  const stock=window.map(date=>barMap.get(record.symbol+'|'+date));
  const bench=window.map(date=>barMap.get(p.benchmark+'|'+date));
  if(stock.some(bar=>!barValid(bar))||bench.some(bar=>!barValid(bar)))return reject('missing_or_invalid_session_bar');
  if([...stock,...bench].some(bar=>bar.corporateAction!==false))return reject('corporate_action_or_price_basis_unverified');
  const first=stock[0],last=stock.at(-1),benchmarkReturn=bench.at(-1).close/bench[0].open-1;
  const rawReturn=last.close/first.open-1;
  const labels={up:rawReturn>0?1:0,outperform:rawReturn>benchmarkReturn?1:0,target_before_stop:null};
  let execution={state:'unknown',netReturn:null,benchmarkReturn,
    adversePriceExcursion:Math.min(...stock.map(bar=>bar.low))/first.open-1};
  if(first.suspended===true||first.canBuyOpen===false)execution.state='unfilled';
  else if(first.suspended!==false||first.canBuyOpen!==true)execution.state='entry_execution_unknown';
  else if(last.suspended===true||last.canSellClose===false)execution.state='exit_unresolved';
  else if(last.suspended!==false||last.canSellClose!==true)execution.state='exit_execution_unknown';
  else{
   const entry=first.open*(1+p.costs.buySlippageBps/10000);
   const exit=last.close*(1-p.costs.sellSlippageBps/10000);
   execution={...execution,state:'cost_scenario',netReturn:exit*(1-p.costs.sellBps/10000)/(entry*(1+p.costs.buyBps/10000))-1};
  }
  return {...base,state:'labelled',entryDate,labelThrough,plannedExit:labelThrough,actualExit:null,
   rawReturn,labels,execution,barrierReason:'OHLC不能证明可成交的止盈止损先后；此目标未评估，不用价格触达冒充交易成功'};
 });
}
export function purgedSplit(cases,protocol,sessions){
 const f=protocol.split,nextAfter=date=>sessions[sessions.indexOf(date)+1+f.embargoSessions];
 const validationStart=nextAfter(f.trainEnd),testStart=nextAfter(f.validationEnd);
 const out={train:[],validation:[],test:[],purged:[],outside:[]};
 for(const c of cases){
  if(c.state!=='labelled'){out.outside.push(c);continue}
  const d=c.decisionDate;
  let key=d<=f.trainEnd?'train':validationStart&&d>=validationStart&&d<=f.validationEnd?'validation':
   testStart&&d>=testStart&&d<=f.testEnd?'test':null;
  const next=key==='train'?validationStart:key==='validation'?testStart:null;
  // A label is available after its close, so sharing the next decision date is conservatively purged.
  if(key&&(c.labelThrough>(key==='train'?f.trainEnd:key==='validation'?f.validationEnd:f.testEnd)||(next&&c.labelThrough>=next)))out.purged.push(c);
  else if(key)out[key].push(c);else out.outside.push(c);
 }
 return out;
}
function probability(forecast,target,record,p,split){
 if(!forecast||forecast.target!==target||forecast.horizonSessions!==p.horizonSessions||
  forecast.startRule!==p.entryRule||forecast.endRule!==p.exitRule||forecast.feeBasis!=='gross_raw_price'||
  forecast.probabilityUnit!==p.probabilityUnit||!forecast.modelVersion||!stamp(forecast.validUntil)||
  Date.parse(forecast.validUntil)<Date.parse(record.generatedAt))return null;
 if(forecast.kind!=='fixed_baseline'&&(!day(forecast.trainedThrough)||forecast.trainedThrough>=record.dataThrough||
   forecast.trainedThrough>p.split.trainEnd))return null;
 if(forecast.kind==='fixed_baseline'&&forecast.value!==(p.probabilityUnit==='percent'?50:.5))return null;
 if(forecast.calibrationTrainedThrough&&(!day(forecast.calibrationTrainedThrough)||forecast.calibrationTrainedThrough>p.split.trainEnd))return null;
 if(forecast.preprocessingTrainedThrough&&(!day(forecast.preprocessingTrainedThrough)||forecast.preprocessingTrainedThrough>p.split.trainEnd))return null;
 if(target==='outperform'&&forecast.benchmark!==p.benchmark)return null;
 const v=forecast.value;
 if(!finite(v)||v<0||v>(p.probabilityUnit==='percent'?100:1))return null;
 return p.probabilityUnit==='percent'?v/100:v;
}
function scores(rows){
 const n=rows.length;if(!n)return {sampleSize:0,accuracy:null,accuracyInterval:null,brier:null,logLoss:null,calibration:[]};
 const hits=rows.filter(r=>(r.p>=.5?1:0)===r.y).length;
 return {sampleSize:n,accuracy:hits/n,accuracyInterval:wilson(hits,n),
  brier:mean(rows.map(r=>(r.p-r.y)**2)),
  logLoss:-mean(rows.map(r=>r.y*Math.log(Math.max(1e-12,r.p))+(1-r.y)*Math.log(Math.max(1e-12,1-r.p)))),
  calibration:Array.from({length:5},(_,bin)=>{
   const list=rows.filter(r=>Math.min(4,Math.floor(r.p*5))===bin);
   return {low:bin/5,high:(bin+1)/5,n:list.length,meanProbability:mean(list.map(r=>r.p)),observedRate:mean(list.map(r=>r.y))};
  })};
}
export function evaluateResearch(input,{partition='validation',allowFinalTest=false,frozenProtocolHash=null,frozenDatasetHash=null}={}){
 const protocol=validateProtocol(input);
 assert(['validation','test'].includes(partition),'only held-out partitions can be scored');
 assert(partition!=='test'||allowFinalTest&&frozenProtocolHash===protocolHash(protocol)&&frozenDatasetHash===datasetHash(input),
  'final test is sealed; explicitly freeze a protocol before requesting it');
 const cases=buildPriceCases(input),split=purgedSplit(cases,protocol,input.sessions),chosen=split[partition];
 const modelNames=[...new Set(chosen.flatMap(c=>Object.keys(c.record.forecasts||{})))].sort();
 const results={};
 for(const target of targets){
  const labelled=chosen.filter(c=>c.labels[target]!==null);
  const rowsFor=name=>labelled.flatMap(c=>{
   const p=probability(c.record.forecasts?.[name]?.[target],target,c.record,protocol,split);
   return p===null?[]:[{id:c.id,p,y:c.labels[target],date:c.decisionDate}];
  });
  const modelRows=new Map(modelNames.map(name=>[name,rowsFor(name)]));
  const common=labelled.filter(c=>modelNames.every(name=>modelRows.get(name).some(row=>row.id===c.id))).map(c=>c.id);
  results[target]={labelled:labelled.length,unsupportedOrUnresolved:chosen.length-labelled.length,
   commonSampleSize:modelNames.length?common.length:0,
   models:modelNames.map(name=>{
    const rows=modelRows.get(name),paired=rows.filter(r=>common.includes(r.id));
    return {name,eligible:labelled.length,predicted:rows.length,abstained:labelled.length-rows.length,
     abstainedFraction:labelled.length?1-rows.length/labelled.length:null,overallUnscoredFraction:chosen.length?1-rows.length/chosen.length:null,...scores(rows),
     commonSample:scores(paired),fixed50BaselineOnCommon:scores(paired.map(r=>({...r,p:.5}))),
     periods:[...new Set(rows.map(r=>r.date.slice(0,7)))].map(month=>({month,...scores(rows.filter(r=>r.date.startsWith(month)))}))};
   })};
 }
 const executionCounts={};for(const c of chosen)executionCounts[c.execution.state]=(executionCounts[c.execution.state]||0)+1;
 const executed=chosen.filter(c=>c.execution.state==='cost_scenario');
 const reasons={};for(const c of cases)if(c.reason)reasons[c.reason]=(reasons[c.reason]||0)+1;
 return {version:VALIDATION_VERSION,protocolId:protocol.id,protocolHash:protocolHash(protocol),datasetCanonicalSha256:datasetHash(input),dataKind:input.dataKind,
  status:input.dataKind==='synthetic'?'framework_test_only':'descriptive_held_out_audit_not_approved',
  approved:false,modelSelected:null,partition,
  targetDefinitions:{up:'下一交易日原始开盘到第N交易日原始收盘的价格上涨，未扣费',
   outperform:'同一窗口原始价格收益跑赢指定基准，未扣费',
   target_before_stop:'尚缺可成交的时间顺序证据，未评估'},
  counts:{submitted:cases.length,labelled:cases.filter(c=>c.state==='labelled').length,
   excluded:cases.filter(c=>c.state==='excluded').length,purged:split.purged.length,
   train:split.train.length,validation:split.validation.length,test:split.test.length,outside:split.outside.length},
  exclusionReasons:reasons,targets:results,
  execution:{counts:executionCounts,netScenarioSamples:executed.length,
   meanNetScenarioReturn:mean(executed.map(c=>c.execution.netReturn)),
   meanBenchmarkGrossReturn:mean(executed.map(c=>c.execution.benchmarkReturn)),
   worstAdversePriceExcursion:chosen.length?Math.min(...chosen.map(c=>c.execution.adversePriceExcursion)):null,
   portfolioMaxDrawdown:null,actualTradingReturn:null},
  ledger:cases.map(({record,...c})=>chosen.some(row=>row.id===c.id)?c:{id:c.id,symbol:c.symbol,decisionDate:c.decisionDate,entryDate:c.entryDate,labelThrough:c.labelThrough,state:c.state==='excluded'?'excluded':'sealed_or_outside_selected_partition',reason:c.reason}),
  limitations:['不训练、不选择或启用模型；不证明最高准确率','特征时间与版本依赖输入记录，元数据声明不能独立证明没有泄漏',
   '历史股票范围：'+input.metadata.universeBasis+'；当前名单不能视为无偏历史样本',
   '净收益仅是显式比例成本与滑点情景，不含最低佣金或组合资金约束',
   '不可成交和退出未解决的样本保留；不假设止损一定能成交，不延长固定预测窗口',
   '日线低点仅给出最不利价格变化，不是实际组合最大回撤；未模拟组合',
   'Wilson区间未修正股票/日期聚类相关性，不能当最终策略置信区间',
   '止损先后目标未评估，不能用价格触达或旧成绩单代替成交验证']};
}
