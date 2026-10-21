import {finiteNumber} from './data-contract.js';

const targets=new Set(['up','outperform','target_before_stop']);

export function probabilityEligibility(value, contract, now=new Date()) {
  const number=finiteNumber(value),v=contract?.validation;
  const defined=targets.has(contract?.target)&&
    Number.isInteger(contract?.days)&&contract.days>0&&
    contract.startRule&&contract.endRule&&contract.feeBasis&&
    (contract.target!=='outperform'||contract.benchmark)&&
    (contract.target!=='target_before_stop'||
      (contract.entryRule&&contract.sameDayOrder==='unknown'));
  const validated=v?.approved===true&&v?.method&&v?.evidenceRef&&
    v?.sampleSize>0&&v?.evaluatedThrough&&
    Number.isFinite(Date.parse(v.validUntil))&&
    Date.parse(v.validUntil)>=now.getTime()&&
    Date.parse(v.evaluatedThrough)<=now.getTime();
  const eligible=number!==null&&number>=0&&number<=100&&
    !!defined&&!!validated;
  return {
    eligible,
    value:eligible?number:null,
    state:eligible?'validated':
      v?.validUntil&&Date.parse(v.validUntil)<now.getTime()?
        'stale':'unverified',
    reason:eligible?null:
      '缺少可追溯且有效的目标定义及验证依据，概率不显示、不参与行动判断'
  };
}

export function guardForecast(item={}) {
  const out={...item,probabilityStatus:'unverified'};
  for (const key of [
    'positiveProbability','outperformProbability','upProbability'
  ]) {
    if (Object.hasOwn(item,key)) {
      const contract=item.probabilityContracts?.[key];
      const expected=key==='outperformProbability'?'outperform':'up';
      const sameHorizon=Number.isInteger(item.days)&&item.days>0&&
        contract?.days===item.days;
      const checked=probabilityEligibility(
        item[key],
        sameHorizon&&contract?.target===expected?contract:null
      );
      out[key]=checked.value;
      if (checked.eligible) out.probabilityStatus='validated';
    }
  }
  if (out.probabilityStatus!=='validated') {
    Object.assign(out,{
      direction:'未判定',
      confidence:'未验证',
      validationAccuracy:null,
      invalidation:'概率判断未启用；请查看独立的结构失效条件'
    });
  }
  if (item.foundation) out.foundation=guardForecast(item.foundation);
  return out;
}

export function sameProbabilityTarget(a,b) {
  return [
    'target','days','startRule','endRule','feeBasis',
    'benchmark','entryRule','sameDayOrder'
  ].every(key=>(a?.[key]??null)===(b?.[key]??null));
}
