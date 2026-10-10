import {assertWindow,finiteNumber} from './data-contract.js';
export const PRICE_VERSION='range20-1';
export const SCREEN_STRATEGY=Object.freeze({version:'range20-t1-review-1',target:'T1',threshold:1.5,state:'incompatible',qualified:null,t2Enabled:false,
  reason:'风险收益筛选配置不兼容：T1与1.5门槛冲突；正式策略待定，合格候选未判定'});
function tickPrice(value,tick,up=false) {
  const units=Number((value/tick).toPrecision(14));
  return Number(((up?Math.ceil(units):Math.floor(units))*tick).toPrecision(14));
}
export function priceLevels(rows,{tick=.01,planType='breakout',entry=null}={}) {
  const baseResult={version:PRICE_VERSION,state:'unavailable',reason:null,planType,priceBasis:'judgment_day_raw',tick,
    dataThrough:rows?.at(-1)?.date||null,entry:null,stop:null,target1:null,target2:null,rr1:null,rr2:null};
  try {
    const window=assertWindow(rows,21,{volume:false}),base=window.slice(0,-1);
    if (!(finiteNumber(tick)>0)) throw Error('该市场的最小报价单位未核验');
    if (!['breakout','pullback'].includes(planType)) throw Error('未知入场计划类型');
    const upper=Math.max(...base.map(r=>r.high)),lower=Math.min(...base.map(r=>r.low)),width=upper-lower;
    const breakout=tickPrice(upper*1.003,tick,true),stop=tickPrice(lower*.997,tick);
    const reference=planType==='breakout'?breakout:finiteNumber(entry);
    if (!(reference>0)) throw Error('回调计划需要明确的入场参考');
    const plannedEntry=tickPrice(reference,tick,true),target1=tickPrice(upper+width,tick),target2=tickPrice(upper+2*width,tick);
    if (!(width>0&&stop>0&&plannedEntry>stop&&target1>plannedEntry&&target2>plannedEntry)) throw Error('价格关系不成立，无法计算风险收益比');
    return {...baseResult,state:'ok',upper,lower,width,breakout,invalidation:stop,entry:plannedEntry,stop,target1,target2,
      rr1:(target1-plannedEntry)/(plannedEntry-stop),rr2:(target2-plannedEntry)/(plannedEntry-stop),
      rounding:'入场向上；止损及目标向下；仅展示时四舍五入比值'};
  } catch(error) { return {...baseResult,reason:error.message}; }
}
export function netRiskReward(levels,qty,fees) {
  const keys=['commissionRatePer10000','minimumCommission','stampDutyRatePer10000','transferFeeRatePer10000'];
  if (levels?.state!=='ok'||!Number.isInteger(qty)||qty<=0||!fees||keys.some(k=>finiteNumber(fees[k])===null||fees[k]<0))
    return {state:'unavailable',reason:'需完整股数、费率及有效价位，无法计算扣费后的风险收益比',rr1:null,rr2:null};
  const cost=(price,sell)=>{
    const amount=price*qty;
    return Math.max(fees.minimumCommission,amount*fees.commissionRatePer10000/10000)+amount*fees.transferFeeRatePer10000/10000+(sell?amount*fees.stampDutyRatePer10000/10000:0);
  };
  const buy=cost(levels.entry,false),risk=qty*(levels.entry-levels.stop)+buy+cost(levels.stop,true);
  const rewards=[levels.target1,levels.target2].map(t=>qty*(t-levels.entry)-buy-cost(t,true));
  return {state:'ok',risk,reward1:rewards[0],reward2:rewards[1],rr1:rewards[0]/risk,rr2:rewards[1]/risk,
    note:'按条件价估算，跳空、跌停、停牌及滑点可能造成额外损失，不是保证最大损失'};
}
export function tradePlanFromLevels(stock,preferences={}) {
  const levels=stock.data?.state==='ok'?(stock.levels||priceLevels(stock.history,{tick:/\.(SS|SZ)$/.test(stock.symbol)?.01:null})):{state:'unavailable',reason:'数据质量未通过',rr1:null,rr2:null};
  const usable=stock.data?.state==='ok'&&levels.state==='ok';
  const cost=finiteNumber(preferences.cost),qty=finiteNumber(preferences.qty),price=stock.history?.at(-1)?.close;
  return {levels,data:stock.data,strategy:SCREEN_STRATEGY,horizon:preferences.horizon||'中期',risk:preferences.risk||'中',riskBudget:null,
    status:usable?'结构参考；正式筛选资格未判定':'数据不足，暂停交易计划判断',dataThrough:stock.data?.dataThrough||null,currentPrice:price,
    support:usable?levels.lower:null,pullbackEntry:{low:null,high:null},breakoutPrice:usable?levels.breakout:null,defensePrice:usable?levels.stop:null,
    target1:usable?levels.target1:null,target2:usable?levels.target2:null,riskReward1:usable?levels.rr1:null,riskReward2:usable?levels.rr2:null,
    cost,qty,estimatedOutcomeAtDefense:usable&&cost>0&&qty>0?(levels.stop-cost)*qty:null,maxEstimatedLoss:null,
    holdingPnl:cost>0&&qty>0&&price>0?(price-cost)*qty:null,net:netRiskReward(levels,qty,preferences.fees),
    conditions:{defenseTriggered:usable&&price<=levels.stop,target1Reached:usable&&price>=levels.target1,target2Reached:usable&&price>=levels.target2},
    basis:'统一20日结构参考；持仓成本仅用于持仓盈亏，不改变目标价。回调计划需另设入场参数；风险预算待设置。'};
}
