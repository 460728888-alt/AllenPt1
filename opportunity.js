// Conservative title-only evidence extraction. Publication dates are never event dates.
export function radarWindow(days = 30, now = new Date()) {
  const count = Number(days);
  if (![7,30,90].includes(count)) throw new Error('请选择未来7、30或90天');
  const start = new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
  const end = new Date(Date.parse(start+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
  return {days:count,start,end};
}
export function titleEvidence(announcements, window) {
  return announcements.filter(a=>a.date && a.date<=window.start).map(a=>{
    const title=String(a.title||'');
    const negative=/减持|诉讼|立案|处罚|亏损|终止|延期|风险提示/.test(title);
    const relevant=negative || /业绩预告|业绩快报|订单|合同|投产|回购|增持|发布会|产品发布|业绩说明会/.test(title);
    if(!relevant)return null;
    const match=title.match(/(?:将于|定于|拟于)\s*(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/);
    let eventDate=null;
    if(match && /将于|定于|拟于/.test(title)){
      const raw=`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
      const date=new Date(raw+'T00:00:00Z');
      if(Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===raw)eventDate=raw;
    }
    return {...a,eventDate,negative,inWindow:!!eventDate&&eventDate>window.start&&eventDate<=window.end,
      status:eventDate?'标题含计划日期，仍需核验公告全文':'事件时间待核验'};
  }).filter(Boolean);
}
export function radarCandidate(stock,research,window,risk='中'){
  const evidence=titleEvidence(research.announcements||[],window);
  const positive=evidence.filter(e=>!e.negative);
  if(!positive.length)return null;
  const confirmed=positive.some(e=>e.inWindow);
  const adverse=evidence.filter(e=>e.negative);
  const hot=Number(stock.changePct)>=5;
  return {symbol:stock.symbol,code:stock.code,name:research.name||stock.name,price:stock.price,
    changePct:stock.changePct,group:confirmed?'窗口内日期线索':'时间待核验',evidence,
    priority:(confirmed?20:0)+Math.min(positive.length,3)*2-adverse.length*4-(hot?(risk==='低'?10:5):0),
    pricedIn:hot?'今日已明显上涨，不能称为提前发现':'单日涨幅不能判断是否已反映预期；需核验历史涨幅与估值',
    invalidation:'事件取消、延期至窗口外，或公告全文不支持业务受益逻辑时，移出本期候选。',
    unknowns:'尚未核验公告全文、事件实际发生概率、利润影响和市场预期；此排序不是上涨概率。'};
}
export async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(next<items.length){const i=next++;try{out[i]={ok:true,value:await fn(items[i])}}catch{out[i]={ok:false}}}
  }));return out;
}
