import {mapLimit} from './opportunity.js';
import {scanCoverage,dataError,originalScaleComparable} from './data-contract.js';
import {analyzeVolumeStructure} from './volume-structure.js';
import {buildVolumeScreenProfile,classifyVolumeCandidate} from './volume-screen.js';
import {SCREEN_STRATEGY} from './price-levels.js';

export async function scanVolumeStocks(source,{quote,tracked=[],onProgress=()=>{}}) {
  const prior=new Map(tracked.map(x=>[x.symbol,x]));
  let done=0,failed=0,found=0;
  const results=await mapLimit(source,8,async item=>{
    try {
      const stock=await quote(item.symbol);
      if (stock.data?.state!=='ok') throw dataError(stock.data?.reasons?.join('；')||'行情质量未核验',stock.data?.state||'insufficient',stock.data?.state==='stale'?'stale_data':'incomplete_data');
      const structure=analyzeVolumeStructure(stock.history),profile=buildVolumeScreenProfile(stock.history,structure);
      const previous=prior.get(stock.symbol),original=previous?.original||null;
      const originalStop=original?.levels?.stop;
      const originalComparable=!original||originalScaleComparable(original,{data:stock.data,dataThrough:stock.data.dataThrough});
      const originalInvalid=originalComparable&&Number.isFinite(originalStop)&&stock.history.at(-1).close<=originalStop;
      const trackingStructure=originalInvalid?{...structure,stage:'结构失效'}:Number.isFinite(originalStop)&&structure.stage==='结构失效'?{...structure,stage:'原始结构仍在跟踪，最新区间需复核'}:structure;
      const label=classifyVolumeCandidate(trackingStructure,profile,{wasTracked:!!previous});
      const observed={symbol:stock.symbol,code:stock.code,name:stock.name,price:stock.history.at(-1).close,
        data:stock.data,dataThrough:stock.data.dataThrough,levels:structure.levels,strategy:SCREEN_STRATEGY,
        structure,profile,originalInvalid,originalComparable,evidence:structure.evidence,priceFactors:stock.history.slice(-60).map(r=>({date:r.date,adjustmentFactor:r.adjustmentFactor,scaleFactor:r.scaleFactor}))};
      let candidate=null;
      if (label) {
        found++;
        candidate={...observed,...label,...(!originalComparable?{tone:'orange',status:'原始判断待复核',reason:'原始与最新价格尺度不可直接比较，暂停原始失效判断'}:{}),researchId:previous?.researchId||null,original,
          confirmPrice:structure.prices.confirm,giveUpPrice:originalStop??structure.prices.invalidation,targetPrice:structure.prices.target1,target2:structure.prices.target2,
          resistanceReference:profile.priorHigh,riskReward:profile.riskReward,riskReward2:profile.riskReward2,stage:structure.stage,volumeRatio:structure.volume.ratio,
          pullbackPct:profile.pullbackPct,firstSeenAt:previous?.firstSeenAt||new Date().toISOString()};
      }
      return {data:stock.data,observed,candidate,reason:label?'进入结构观察或原机会复核':'本次不满足结构观察条件，正式资格仍未判定'};
    } catch(error) { if (!error.state||error.state==='request_failed') failed++;throw error; }
    finally { done++;onProgress({checked:done,total:source.length,found,failed,qualified:null}); }
  });
  const coverage=scanCoverage(results,source.length);
  const observations=results.filter(r=>r.ok).map(r=>r.value.observed);
  const all=results.filter(r=>r.ok&&r.value.candidate).map(r=>r.value.candidate).sort((a,b)=>a.rank-b.rank||a.symbol.localeCompare(b.symbol));
  return {coverage,observations,items:all.slice(0,60),counts:{qualified:null,observations:all.length,displayed:Math.min(60,all.length)},strategy:SCREEN_STRATEGY,
    audit:results.map((r,i)=>({symbol:source[i].symbol,inObservation:!!r.value?.candidate,reason:r.ok?r.value.reason:r.error.message,error:r.error||null})),
    message:coverage.usable===0?'无法完成判断':coverage.partial?'已完成核验范围内未发现的候选不代表其余范围没有机会；其余范围未知':'已完成当前范围结构核验；正式风险收益资格未判定'};
}
