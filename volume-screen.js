import {finiteNumber as finite,assertWindow} from './data-contract.js';
import {priceLevels,SCREEN_STRATEGY} from './price-levels.js';
const average=values=>{
  const usable=values.map(finite).filter(Number.isFinite);
  return usable.length?usable.reduce((sum,value)=>sum+value,0)/usable.length:null;
};
const maxOf=(rows,key)=>Math.max(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));
const minOf=(rows,key)=>Math.min(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));

export function buildVolumeScreenProfile(inputRows,structure){
  const rows=assertWindow(inputRows,60);
  if(rows.length<60)throw new Error('筛选至少需要60个有效交易日');
  const prior=rows.slice(-60,-20),recent=rows.slice(-20);
  const priorHigh=maxOf(prior,'high'),recentLow=minOf(recent,'low');
  const pullbackPct=(recentLow/priorHigh-1)*100;
  const recentVolume=average(rows.slice(-5).map(row=>row.volume));
  const baseVolume=average(rows.slice(-25,-5).map(row=>row.volume));
  const volumeDryRatio=recentVolume/baseVolume;
  const levels=structure?.levels||priceLevels(rows);
  const riskReward=levels.rr1;
  return {
    levels,strategy:SCREEN_STRATEGY,
    priorHigh:Number(priorHigh.toFixed(2)),
    pullbackPct:Number(pullbackPct.toFixed(1)),
    usefulPullback:pullbackPct<=-5&&pullbackPct>=-30,
    volumeDryRatio:Number(volumeDryRatio.toFixed(2)),
    volumeDriedUp:volumeDryRatio<=.9,
    priceTight:Boolean(structure?.evidence?.compression),
    lowsStoppedFalling:Boolean(structure?.evidence?.lowsRising),
    riskReward,riskReward2:levels.rr2
  };
}

export function classifyVolumeCandidate(structure,profile,{wasTracked=false}={}){
  if(!structure||!profile)return null;
  if(wasTracked&&structure.stage==='结构失效')return {tone:'red',rank:4,status:'🔴 走势坏了，先删掉',reason:'收盘已触及原始失效价，原来的等待逻辑失效。'};
  // T1 + 1.5 is mathematically incompatible. T2 has NOT been authorized.
  const yellow=profile.usefulPullback&&profile.volumeDriedUp&&profile.priceTight&&profile.lowsStoppedFalling;
  if(yellow)return {tone:'yellow',rank:2,status:'🟡 结构观察，资格未判定',reason:'前面有回调，现在波动变小、成交量缩小，低点也没有继续下移。'};
  if(wasTracked)return {tone:'orange',rank:3,status:'🟠 还没走好，继续等',reason:'这只股票之前符合条件，但现在还没有出现放量向上确认。'};
  return null;
}
