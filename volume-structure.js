const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const average = values => {
  const usable=values.map(finite).filter(Number.isFinite);
  return usable.length ? usable.reduce((sum,value)=>sum+value,0)/usable.length : null;
};
const round = (value,digits=2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const pct = (from,to) => Number.isFinite(from)&&Number.isFinite(to)&&from!==0 ? (to/from-1)*100 : null;
const maxOf = (rows,key) => Math.max(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));
const minOf = (rows,key) => Math.min(...rows.map(row=>finite(row[key]??row.close)).filter(Number.isFinite));

function volumeLabel(ratio,recentRatio){
  if(ratio>=1.5)return '明显放量';
  if(ratio>=1.2)return '温和放量';
  if(recentRatio<=.78)return '持续缩量';
  if(ratio<=.8)return '当日缩量';
  return '量能平稳';
}

function stageResult(stage,tone,action,summary){return {stage,tone,action,summary}}

export function analyzeVolumeStructure(inputRows){
  const rows=(inputRows||[]).map(row=>({
    ...row,
    close:finite(row.close),open:finite(row.open),high:finite(row.high),low:finite(row.low),volume:finite(row.volume)
  })).filter(row=>Number.isFinite(row.close)&&Number.isFinite(row.volume));
  if(rows.length<35)throw new Error('量价结构分析至少需要35个有效交易日');

  const current=rows.at(-1),previous=rows.at(-2);
  const base=rows.slice(-21,-1),recent5=rows.slice(-5),recent10=rows.slice(-10);
  const upper=maxOf(base,'high'),lower=minOf(base,'low');
  const midpoint=(upper+lower)/2,rangePct=(upper-lower)/midpoint*100;
  const avgVolume20=average(base.map(row=>row.volume));
  const avgVolume5=average(recent5.map(row=>row.volume));
  const volumeRatio=current.volume/avgVolume20;
  const recentVolumeRatio=avgVolume5/avgVolume20;
  const ma5=average(recent5.map(row=>row.close));
  const ma20=average(rows.slice(-20).map(row=>row.close));
  const low10=minOf(recent10,'low'),priorLow10=minOf(rows.slice(-20,-10),'low');
  const high10=maxOf(recent10,'high'),priorHigh10=maxOf(rows.slice(-20,-10),'high');
  const lowsRising=low10>=priorLow10*.995;
  const highsTightening=high10<=priorHigh10*1.025;
  const compression=rangePct<=12&&Math.abs(pct(ma20,ma5))<=5;
  const breakout=current.close>=upper*1.003&&volumeRatio>=1.5;
  const breakdown=current.close<=lower*.997&&volumeRatio>=1.3;
  const nearUpper=current.close>=upper*.985;
  const nearLower=current.close<=lower*1.02;
  const recentBreakout=rows.slice(-8,-1).some((row,index,arr)=>{
    const history=rows.slice(Math.max(0,rows.length-28+index),rows.length-8+index);
    if(history.length<12)return false;
    const level=maxOf(history,'high'),normalVolume=average(history.slice(-20).map(item=>item.volume));
    return row.close>=level*1.002&&row.volume>=normalVolume*1.3;
  });
  const pullback=recentBreakout&&current.close>=lower&&current.close<=upper*1.035&&volumeRatio<=1.15;
  let decision;
  if(breakdown)decision=stageResult('结构失效','red','暂停考虑','放量跌破近20日结构下沿，原蓄势假设暂时失效。');
  else if(breakout)decision=stageResult('向上突破待确认','green','进入确认观察','收盘放量突破结构上沿，等待随后1—3个交易日能否守住突破位。');
  else if(pullback)decision=stageResult('突破后回踩','green','观察回踩确认','此前曾出现放量突破，目前缩量回踩；守住突破区域才属于有效确认。');
  else if(compression&&nearUpper)decision=stageResult('上沿试探','blue','关注但不追涨','价格接近结构上沿，但量价尚未同时达到突破确认标准。');
  else if(compression&&lowsRising&&recentVolumeRatio<=1)decision=stageResult('横盘蓄势','yellow','继续等待','波动收窄、低点未明显下移且近期量能收缩，正在等待方向选择。');
  else if(nearLower||ma5<ma20)decision=stageResult('回调观察','orange','等待止跌','价格处于结构下部或短期均价仍弱，尚未形成向上确认。');
  else decision=stageResult('区间震荡','yellow','继续等待','价格仍在结构区间内，当前没有足够量能证明方向。');

  const confirmPrice=upper*1.003,invalidationPrice=lower*.997,target1=upper+(upper-lower);
  const risk=Math.max(.01,confirmPrice-invalidationPrice),reward=target1-confirmPrice;
  const position=current.close>=upper?'上方':current.close<=lower?'下方':current.close>=midpoint?'区间上半部':'区间下半部';
  return {
    ...decision,
    currentPrice:round(current.close),
    windowDays:20,
    range:{lower:round(lower),upper:round(upper),midpoint:round(midpoint),widthPct:round(rangePct,1)},
    prices:{confirm:round(confirmPrice),invalidation:round(invalidationPrice),target1:round(target1)},
    volume:{current:Math.round(current.volume),average20:Math.round(avgVolume20),ratio:round(volumeRatio,2),recentRatio:round(recentVolumeRatio,2),label:volumeLabel(volumeRatio,recentVolumeRatio)},
    evidence:{compression,lowsRising,highsTightening,nearUpper,nearLower,aboveMa20:current.close>=ma20,ma5:round(ma5),ma20:round(ma20),position},
    riskReward:round(reward/risk,2),
    confirmation:`收盘不低于 ${round(confirmPrice)}，且当日成交量达到20日均量的1.5倍以上`,
    invalidation:`收盘不高于 ${round(invalidationPrice)}，且成交量达到20日均量的1.3倍以上`,
    note:'结构判断只使用已完成的日线和成交量；盘中突破、单日脉冲或无量上涨不视为确认。'
  };
}
