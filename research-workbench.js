/* Allen research workbench: presentation and provenance only; no trading strategy. */
(function(root){
  'use strict';
  const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
    Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const ended=status=>['invalidated','closed','expired'].includes(status);
  const labels=Object.freeze({
    trend:'趋势待核验',pullback:'回调观察',compression:'收窄整理',
    trigger:'价格触发·待确认',follow:'后续跟踪',paused:'暂停核验',invalid:'已失效',event:'事件线索'
  });
  function quality(snapshot={},context={}){
    const state=snapshot.data?.state,through=snapshot.dataThrough||snapshot.data?.dataThrough;
    if(!date(through))return {state:'insufficient',label:'数据截止未知',reason:'缺少有效数据截止日期'};
    if(state==='ok'&&!(number(snapshot.price)>0))return {state:'insufficient',label:'价格待核验',reason:'有效价格缺失，暂停当前阶段判断'};
    if(state!=='ok')return {state:state||'insufficient',label:state==='stale'?'数据过期':state==='request_failed'?'请求失败':'数据不足',
      reason:(snapshot.data?.reasons||[]).join('；')||'数据质量未通过，暂停新的确认与失效判断'};
    if(!context.verified||!date(context.expectedThrough))return {state:'unverified',label:'时效待核验',reason:'交易日历或服务状态尚未核验，不能把留档行情当作当前行情'};
    if(through<context.expectedThrough)return {state:'stale',label:'历史观察·待刷新',reason:'当前应有完整日线截至 '+context.expectedThrough+'；本条仍为 '+through};
    if(through>context.expectedThrough)return {state:'insufficient',label:'日期待核验',reason:'数据截止晚于已核验的完整交易日'};
    return {state:'ok',label:context.historical?'当时数据标记':'完整日线已对齐',reason:context.historical?'仅还原留档标记，未事后补造原始证据':'数据截止与当前交易日历一致'};
  }
  function facts(snapshot={}){
    const p=snapshot.profile||{},s=snapshot.structure||{},e=s.evidence||snapshot.evidence||{},v=s.volume||{},levels=snapshot.levels||s.levels||{};
    const through=snapshot.dataThrough||snapshot.data?.dataThrough||null,validData=snapshot.data?.state==='ok'&&number(snapshot.price)>0;
    const fact=(id,title,passed,value,basis)=>({id,title,state:!validData?'unknown':passed===true?'supported':passed===false?'contrary':'unknown',value:validData?value:null,basis,dataThrough:through,
      source:'原始扫描字段；'+(snapshot.strategy?.version||'策略版本未留存')});
    return [
      fact('trend','此前上涨趋势',null,null,'原扫描未留存足够的先前上涨趋势及阶段先后证据；不能从均线同时向好推断完整策略成立。'),
      fact('pullback','回调幅度',typeof p.usefulPullback==='boolean'?p.usefulPullback:null,number(p.pullbackPct),
        '前40日最高价与最近20日最低价比较：(最近20日最低价 / 前40日最高价 − 1) × 100%；旧观察范围为 −30% 至 −5%。该范围不是已验证策略。'),
      fact('volume','近期缩量',typeof p.volumeDriedUp==='boolean'&&number(p.volumeDryRatio)>0?p.volumeDriedUp:null,number(p.volumeDryRatio),
        '最近5根完整日线平均成交量 / 此前20根平均成交量；旧观察条件 ≤ 0.9。缺失成交量不作缩量结论；展示取整不参与判断。'),
      fact('compression','整理收窄',typeof p.priceTight==='boolean'?p.priceTight:typeof e.compression==='boolean'?e.compression:null,number(s.range?.widthPct),
        '旧扫描要求此前20根结构区间宽度 / 区间中点 ≤ 12%，且最近 MA5 相对 MA20 的偏离不超过 5%；这不是波动逐渐收窄的完整历史证明。'),
      fact('lows','低点未继续下移',typeof p.lowsStoppedFalling==='boolean'?p.lowsStoppedFalling:typeof e.lowsRising==='boolean'?e.lowsRising:null,null,
        '最近10根最低价 ≥ 前10根最低价 × 0.995。仅解释旧观察条件，不保证后续上涨。'),
      fact('trigger','价格与量能触发',
        typeof s.stage==='string'&&s.stage?s.stage==='向上突破待确认':null,number(v.ratio),
        '完整日线收盘价 ≥ 此前20根上沿 × 1.003（按报价单位向上处理），且当日成交量 / 此前20根均量 ≥ 1.5。图示量比已取整，仅作显示；触发状态使用当时未取整判断的原始阶段字段，不重新拿显示值判定。触发不等于策略有效或可成交。')
    ];
  }
  function stage(item={},context={}){
    const status=item.researchStatus||item.statusCode;
    if(status==='invalidated')return {key:'invalid',label:labels.invalid,reason:'原始研究已留档失效；保留失败记录'};
    if(['closed','expired'].includes(status))return {key:'follow',label:status==='expired'?'研究已到期':'研究已结束',reason:'等待复盘；完成或到期均不代表盈利'};
    const q=quality(item,context);
    if(item.latestKind==='data_gap'||q.state!=='ok')return {key:'paused',label:labels.paused,reason:q.reason};
    if(item.originalComparable===false)return {key:'paused',label:labels.paused,reason:'原始与最新价格尺度不可直接比较，暂停确认与失效判断'};
    if(item.channel==='radar')return {key:'event',label:labels.event,reason:'公告线索与价格确认分别核验'};
    if(item.structure?.stage==='结构失效'||number(item.price)>0&&number(item.original?.levels?.stop)>0&&item.price<=item.original.levels.stop)return {key:'follow',label:'原判断需复核',reason:'最新价格或区间需复核；原研究是否失效以已留档事件为准，不补造结论'};
    if(status==='review')return {key:'follow',label:'原判断需复核',reason:'查看追加记录，核对新的支持与反面证据'};
    const f=facts(item);
    if(f.find(x=>x.id==='trigger').state==='supported')return {key:'trigger',label:labels.trigger,reason:'仅价格与量能条件触发；先前趋势、阶段顺序及收益优势仍待验证'};
    if(f.find(x=>x.id==='compression').state==='supported')return {key:'compression',label:labels.compression,reason:'结构收窄可观察；此前上涨趋势仍待核验'};
    if(f.find(x=>x.id==='pullback').state==='supported')return {key:'pullback',label:labels.pullback,reason:'幅度符合旧观察条件，尚不能确认是上涨后的正常回调'};
    return {key:'trend',label:labels.trend,reason:'先核对上涨趋势和先后关系，继续等待'};
  }
  function cards(scan,history=[],context={}){
    const byId=new Map();
    for(const record of history){
      if(!record?.researchId)continue;
      const latest=record.latest?.snapshot||record.original||{};
      byId.set(record.researchId,{
        ...latest,symbol:record.symbol,name:record.name||latest.name,
        researchId:record.researchId,original:record.original,snapshotHash:record.snapshotHash,
        generatedAt:record.firstSeenAt,strategyVersion:record.strategyVersion,
        researchStatus:record.status,latestKind:record.latestKind,channel:record.channel||'volume',observationSaved:true
      });
    }
    for(const raw of [...(scan?.items||[]),...(scan?.retained||[])]){
      const id=raw.researchId||'unsaved:'+String(scan?.id||'latest')+':'+raw.symbol;
      const old=byId.get(id);
      const useOld=old?.dataThrough&&(!raw.dataThrough||old.dataThrough>raw.dataThrough);
      byId.set(id,useOld?old:{...old,...raw,
        original:old?.original||raw.original,
        researchStatus:old?.researchStatus||raw.researchStatus,
        latestKind:old?.latestKind||raw.latestKind,channel:old?.channel||'volume',observationSaved:scan?.storage?.durable===true,
        researchId:raw.researchId||null,viewId:id});
    }
    const rank={trigger:0,compression:1,pullback:2,trend:3,follow:4,event:5,paused:6,invalid:7};
    return [...byId.values()].map(item=>({...item,viewId:item.researchId||item.viewId,
      quality:quality(item,context),phase:stage(item,context)}))
      .sort((a,b)=>(rank[a.phase.key]-rank[b.phase.key])||
        String(a.symbol).localeCompare(String(b.symbol))||
        String(a.viewId).localeCompare(String(b.viewId)));
  }
  function scanState(scan,error){
    if(error)return {key:'failed',label:'无法完成判断',detail:String(error)};
    if(!scan)return {key:'not_started',label:'尚未扫描',detail:'先运行量价筛选；没有扫描记录不等于没有机会。'};
    const c=scan.coverage;
    if(!c||number(c.usable)===null)return {key:'insufficient',label:'无法完成判断',detail:'覆盖范围或可判断数量未留存。'};
    if(c.usable===0)return {key:'insufficient',label:'无法完成判断',detail:'本次没有可判断的数据；不能显示成没有机会。'};
    if(c.partial||c.usable<c.requested)return {key:'partial',label:'部分范围未核验',detail:'仅说明已核验范围；其余范围未知。'};
    if(!(scan.items||[]).length)return {key:'empty',label:'已核验范围暂无结构观察',detail:'可以继续等待；正式合格候选仍未判定。'};
    return {key:'observations',label:'发现结构观察',detail:'观察候选不等于已确认买点。'};
  }
  function asOf(record,mode='original'){
    if(!record?.original)throw Error('没有真实原始快照，不能声称回到当时');
    const original=record.original,events=mode==='later'?(record.events||[]):[];
    const latest=[...events].reverse().find(event=>event.payload?.snapshot)?.payload.snapshot;
    return {snapshot:latest||original,original,events,mode,provenance:'recorded',
      generatedAt:record.generatedAt||original.generatedAt||null};
  }
  function points(record,mode='original'){
    const view=asOf(record,mode),seen=new Map();
    const add=(snapshot,kind,index)=>{
      const d=snapshot?.dataThrough||snapshot?.data?.dataThrough,price=number(snapshot?.price);
      if(!date(d)||!(price>0)||snapshot.data?.state!=='ok')return;
      seen.set(d,{date:d,price,kind,index});
    };
    add(record.original,'original',-1);
    view.events.forEach((e,index)=>add(e.payload?.snapshot,e.kind,index));
    return [...seen.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }
  function coverage(scan){
    const c=scan?.coverage||{};
    return {requested:number(c.requested),returned:number(c.returned),failed:number(c.failed),usable:number(c.usable),
      pct:number(c.coveragePct),observations:number(scan?.counts?.observations),
      displayed:(scan?.items||[]).length,qualified:null,
      failures:Array.isArray(c.failures)?c.failures:[],range:c.dateRange||null};
  }
  root.AllenWorkbench=Object.freeze({labels,quality,facts,stage,cards,scanState,asOf,points,coverage,number,date,ended});
})(globalThis);
