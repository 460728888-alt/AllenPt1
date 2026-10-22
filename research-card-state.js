// Only a persisted event can label an original hypothesis invalidated.
export function researchCardState(item,stored) {
  if (!stored?.snapshot || !stored.research_id) throw Error('原始研究快照读取失败，未完成保存');
  const state=stored.latest_state,stop=stored.snapshot.levels?.stop;
  const out={...item,researchId:stored.research_id,original:stored.snapshot,
    snapshotHash:stored.snapshot_hash,giveUpPrice:Number.isFinite(stop)&&stop>0?stop:null,
    originalInvalid:state?.status==='invalidated',researchStatus:state?.status||'unverified',
    researchStatusThrough:state?.dataThrough||null};
  if (state?.status==='invalidated') return {...out,tone:'red',status:'🔴 原始结构已失效',
    reason:'依据已留档的判断；本次缺失数据不作为新的失效依据'};
  if (['closed','expired'].includes(state?.status)) return {...out,tone:'orange',status:'原研究已结束',
    reason:'保留原始记录；新的机会须另建研究编号'};
  const date=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
    Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
  const cutoff=item.dataThrough,recordedCutoff=state?.dataThrough;
  const outdated=date(cutoff)&&date(recordedCutoff)&&cutoff<recordedCutoff;
  const uncertain=!state || !['tracking','review'].includes(state.status) ||
    state.kind==='data_gap' || item.data?.state!=='ok' ||
    !Number.isFinite(item.price) || item.price<=0 || !Number.isFinite(stop) || stop<=0 ||
    !date(cutoff) || !date(recordedCutoff) || outdated;
  if (uncertain) return {...out,tone:'orange',status:'当前数据待核验',
    reason:outdated?'本次数据早于已留档时点，保留原判断':'数据或原始条件不足，暂停新的确认及失效判断'};
  if (state.status==='review' || item.tone==='red' || item.price<=stop)
    return {...out,tone:'orange',status:'原判断需要复核',
      reason:'扫描条件与留档状态需复核，不补造失效结论'};
  return out;
}
