const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const average=values=>{
  const usable=values.map(finite).filter(Number.isFinite);
  return usable.length?usable.reduce((sum,value)=>sum+value,0)/usable.length:null;
};
const maxOf=(rows,key)=>Math.max(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));
const minOf=(rows,key)=>Math.min(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));

export function buildVolumeScreenProfile(inputRows,structure){
  const rows=(inputRows||[]).filter(row=>Number.isFinite(finite(row.close))&&Number.isFinite(finite(row.volume)));
  if(rows.length<60)throw new Error('筛选至少需要60个有效交易日');
  const prior=rows.slice(-60,-20),recent=rows.slice(-20);
  const priorHigh=maxOf(prior,'high'),recentLow=minOf(recent,'low');
  const pullbackPct=(recentLow/priorHigh-1)*100;
  const recentVolume=average(rows.slice(-5).map(row=>row.volume));
  const baseVolume=average(rows.slice(-25,-5).map(row=>row.volume));
  const volumeDryRatio=recentVolume/baseVolume;
  const confirm=finite(structure?.prices?.confirm),giveUp=finite(structure?.prices?.invalidation);
  const risk=Number.isFinite(confirm)&&Number.isFinite(giveUp)?confirm-giveUp:null;
  const riskReward=Number.isFinite(risk)&&risk>0?(priorHigh-confirm)/risk:null;
  return {
    priorHigh:Number(priorHigh.toFixed(2)),
    pullbackPct:Number(pullbackPct.toFixed(1)),
    usefulPullback:pullbackPct<=-5&&pullbackPct>=-30,
    volumeDryRatio:Number(volumeDryRatio.toFixed(2)),
    volumeDriedUp:volumeDryRatio<=.9,
    priceTight:Boolean(structure?.evidence?.compression),
    lowsStoppedFalling:Boolean(structure?.evidence?.lowsRising),
    riskReward:Number.isFinite(riskReward)?Number(riskReward.toFixed(2)):null
  };
}

export function classifyVolumeCandidate(structure,profile,{wasTracked=false}={}){
  if(!structure||!profile)return null;
  if(wasTracked&&structure.stage==='结构失效')return {tone:'red',rank:4,status:'🔴 走势坏了，先删掉',reason:'已经放量跌破整理区间，原来的等待逻辑失效。'};
  const green=profile.usefulPullback&&profile.riskReward>=1.5&&['向上突破待确认','突破后回踩'].includes(structure.stage);
  if(green)return {tone:'green',rank:1,status:'🟢 可以重点看',reason:structure.stage==='突破后回踩'?'已经突破，现在看回踩能不能守住。':'价格和成交量一起突破，等1—3天确认能否站稳。'};
  const yellow=profile.usefulPullback&&profile.volumeDriedUp&&profile.priceTight&&profile.lowsStoppedFalling;
  if(yellow)return {tone:'yellow',rank:2,status:'🟡 快到买点了',reason:'前面有回调，现在波动变小、成交量缩小，低点也没有继续下移。'};
  if(wasTracked)return {tone:'orange',rank:3,status:'🟠 还没走好，继续等',reason:'这只股票之前符合条件，但现在还没有出现放量向上确认。'};
  return null;
}
