import {radarWindow,mapLimit} from './opportunity.js';

export const categories=[
 ['业绩变化',/业绩预告|业绩快报|盈利预测|业绩说明会/,'业绩能否改善，需要核验增速、现金流及市场原有预期。'],
 ['订单与项目',/中标|订单|重大.*合同|重大.*协议|投产|扩产|产能|项目进展/,'订单或产能可能带来收入，但交付、利润率和回款决定能否兑现。'],
 ['产品与技术',/新产品|产品发布|获批|注册证|临床|研发进展|技术突破/,'产品进展可能打开需求，仍需核验商业化时间、客户和成本。'],
 ['资本与股东',/回购|增持|股权激励|并购|重组|收购/,'资本动作可能改变预期，但不等于公司盈利已经增长。']
];
export const negativePattern=/减持|立案|处罚|诉讼|仲裁|亏损|终止|延期|风险提示|违约/;
const fullDate=/(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日/g;
export function eventCategory(title){return categories.find(([,pattern])=>pattern.test(title));}
export function validDate(y,m,d){const raw=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;const n=new Date(raw+'T00:00:00Z');return Number.isFinite(n.getTime())&&n.toISOString().slice(0,10)===raw?raw:null;}
export function extractEvidence(article,window){
 const text=String(article.text||'').replace(/[ \t]+/g,' ').replace(/\r/g,'');
 const dates=[];
 // Preserve the surrounding source passage. Do not infer dates from publication timestamps.
 for(const match of text.matchAll(fullDate)){
   const date=validDate(match[1],match[2],match[3]);
   const passage=text.slice(Math.max(0,match.index-70),Math.min(text.length,match.index+100)).replace(/\n/g,' ');
   if(date&&date>window.start&&/将于|拟于|定于|计划|预计|召开|举行|投产|上市|发布|实施|完成/.test(passage))dates.push({date,passage,inWindow:date<=window.end});
 }
 const sentences=text.split(/[。；\n]/).map(s=>s.trim()).filter(s=>s.length>15);
 const take=(pattern,n)=>sentences.filter(s=>pattern.test(s)).slice(0,n).map(s=>s.slice(0,400));
 return {...article,text:undefined,bodyRead:text.length>100,bodyChars:text.length,
   eventDates:dates.slice(0,8),benefitPassages:take(/收入|利润|需求|订单|产能|金额|增长|积极影响/,3),
   riskPassages:take(/不确定|风险|延期|终止|不构成|尚需|以.*为准|无法|未能|不保证/,3),
   timingPassages:take(/年底|季度|工期|实施期限|有效期|月内|日内|工作日/,3),
   negative:negativePattern.test(article.title),type:eventCategory(article.title)?.[0]||'其他事件'};
}
export function normalizeFeed(raw,now=new Date()){
 const today=new Date(now.getTime()+8*3600000).toISOString().slice(0,10);
 return (raw||[]).flatMap(a=>{
   const date=String(a.notice_date||'').slice(0,10);
   const visible=String(a.display_time||'').slice(0,19).replace(' ','T');
   // Some announcements dated tomorrow are already published tonight. Retain actual display timestamp.
   const published=visible&&Number.isFinite(Date.parse(visible+'+08:00'))?Date.parse(visible+'+08:00'):Date.parse(date+'T23:59:59+08:00');
   if(!Number.isFinite(published)||published>now.getTime())return [];
   return (a.codes||[]).filter(c=>/^(600|601|603|605|688|000|001|002|003|300|301)\d{3}$/.test(c.stock_code)).map(c=>({
     id:a.art_code,code:c.stock_code,symbol:c.stock_code.startsWith('6')?c.stock_code+'.SS':c.stock_code+'.SZ',
     name:c.short_name,title:String(a.title_ch||a.title||''),date,publishedAt:new Date(published).toISOString(),
     link:`https://data.eastmoney.com/notices/detail/${c.stock_code}/${a.art_code}.html`,seenOn:today
   }));
 });
}
export function historyChange(history,bars){
 const closes=(history||[]).map(x=>x.close).filter(x=>Number.isFinite(x)&&x>0);
 return closes.length>bars?Number(((closes.at(-1)/closes.at(-1-bars)-1)*100).toFixed(2)):null;
}
export function rankIdea(idea,window,risk){
 const timed=idea.evidence.some(e=>!e.negative&&e.eventDates.some(d=>d.inWindow));
 const adverse=idea.evidence.filter(e=>e.negative).length;
 const bodies=idea.evidence.filter(e=>e.bodyRead).length;
 const stretched=Number.isFinite(idea.return20)&&idea.return20>15;
 const pricePenalty=stretched?(risk==='低'?18:risk==='中'?12:8):0;
 const financialPenalty=idea.finance?.profitGrowth<0?6:0;
 return {...idea,group:timed?'窗口内计划事件':'时间待核验',priority:(timed?30:0)+Math.min(bodies,3)*4-adverse*8-pricePenalty-financialPenalty,
   rankBreakdown:{windowEvidence:timed?30:0,bodyEvidence:Math.min(bodies,3)*4,negativeEvidence:-adverse*8,alreadyRisen:-pricePenalty,profitChange:-financialPenalty},
   pricedIn:Number.isFinite(idea.return20)?`最近20个交易日价格变化 ${idea.return20}%。${stretched?'已有明显涨幅，应优先核验预期是否已反映。':'没有大涨也不意味着低估；市场预期仍需核验。'}`:'历史行情未取得，不能判断是否已经提前上涨。',
   invalidation:'事件延期至窗口外或取消；商业化、交付或回款不及预期；新证据否定受益链。',
   unknowns:'计划不等于必然发生，披露收益不等于超出市场预期；规则排序不是上涨概率。'};
}
export function validateCriteria(body={}){
 const window=radarWindow(body.days??30);
 const limit=Number(body.announcementLimit??1000);if(![1000,3000].includes(limit))throw Error('公告扫描范围无效');
 const type=body.eventType||'全部';if(!['全部',...categories.map(c=>c[0])].includes(type))throw Error('事件类型无效');
 const maxRunup=Number(body.maxRunup??30);if(!Number.isFinite(maxRunup)||maxRunup<0||maxRunup>200)throw Error('涨幅上限应为0至200');
 return {window,announcementLimit:limit,eventType:type,risk:['低','中','高'].includes(body.risk)?body.risk:'中',maxRunup,keyword:String(body.keyword||'').trim().slice(0,40)};
}
export async function buildRadar(criteria,deps,progress=()=>{}){
 const {window,risk,announcementLimit,eventType,keyword,maxRunup}=criteria;
 progress('正在获取跨股票公告与行情',0,1);
 const [feedResult,marketResult]=await Promise.allSettled([deps.feed(announcementLimit),deps.market()]);
 if(feedResult.status!=='fulfilled')throw Error('公告数据源不可用，无法生成有证据的候选');
 const feed=feedResult.value;
 const market=marketResult.status==='fulfilled'?marketResult.value:{rows:[],total:null,pages:0};
 const marketMap=new Map(market.rows.map(s=>[s.symbol,s]));
 const items=normalizeFeed(feed.items);
 const grouped=new Map();
 for(const a of items){if(!grouped.has(a.symbol))grouped.set(a.symbol,[]);grouped.get(a.symbol).push(a);}
 const titleMatches=[...grouped.entries()].map(([symbol,evidence])=>({symbol,evidence,
   matching:evidence.filter(e=>{const category=eventCategory(e.title);return category&&!negativePattern.test(e.title)&&(eventType==='全部'||category[0]===eventType)&&(!keyword||`${e.name} ${e.code} ${e.title}`.includes(keyword));})})).filter(g=>g.matching.length);
 titleMatches.sort((a,b)=>b.matching.length-a.matching.length||String(b.matching[0].publishedAt).localeCompare(String(a.matching[0].publishedAt))||a.symbol.localeCompare(b.symbol));
 // Deep reading is bounded independently of the broad announcement sweep; all excluded counts are returned.
 const selected=titleMatches.slice(0,announcementLimit===3000?60:40);
 let done=0;
 const checked=await mapLimit(selected,3,async g=>{
   const chosen=[...g.evidence.filter(e=>negativePattern.test(e.title)).slice(0,1),...g.matching.slice(0,2)];
   const evidence=[];
   for(const a of chosen){try{const content=await deps.content(a.id);evidence.push(extractEvidence({...a,...content},window));}catch{evidence.push(extractEvidence({...a,text:'',bodyError:'正文不可用'},window));}}
   done++;progress('读取公告正文与反面证据',done,selected.length);
   const stock=marketMap.get(g.symbol);
   return {symbol:g.symbol,code:g.matching[0].code,name:g.matching[0].name,price:stock?.price??null,changePct:stock?.changePct??null,evidence,
     rationale:eventCategory(g.matching[0].title)?.[2]||'继续核验业务影响',return20:null,return60:null};
 });
 let ideas=checked.filter(x=>x.ok).map(x=>rankIdea(x.value,window,risk)).sort((a,b)=>b.priority-a.priority||a.symbol.localeCompare(b.symbol));
 const deep=ideas.slice(0,12);done=0;
 const enriched=await mapLimit(deep,3,async idea=>{
   const [research,quote]=await Promise.allSettled([deps.research(idea.symbol),deps.quote(idea.symbol)]);
   const r=research.status==='fulfilled'?research.value:null,q=quote.status==='fulfilled'?quote.value:null;
   done++;progress('核验历史涨幅、财务和公司业务',done,deep.length);
   return rankIdea({...idea,name:r?.name&&r.name!==idea.symbol?r.name:idea.name,price:q?.price??idea.price,
     quoteAt:q?.marketTime?new Date(q.marketTime*1000).toISOString():null,return20:historyChange(q?.history,20),return60:historyChange(q?.history,60),
     history:q?.history||[],technical:q?.technical||null,
     company:r?.company?{industry:r.company.industry,business:r.company.business?.slice(0,800)}:null,
     finance:r?.finance?{reportDate:r.finance.reportDate,noticeDate:r.finance.noticeDate,revenueGrowth:r.finance.revenueGrowth,profitGrowth:r.finance.profitGrowth,netMargin:r.finance.netMargin,debtRatio:r.finance.debtRatio}:null},window,risk);
 });
 const assessed=enriched.filter(x=>x.ok).map(x=>x.value);
 const modelDays=window.days<=7?5:window.days<=30?20:60;
 const ranked=deps.ranker?deps.ranker(assessed,modelDays):{status:{engine:'证据规则',active:false,message:'排序模型未接入'},items:assessed.map(idea=>({...idea,modelRanking:null}))};
 const rankedAssessed=ranked.items;
 const excluded=rankedAssessed.filter(i=>!Number.isFinite(i.return20)||i.return20>maxRunup).map(i=>({symbol:i.symbol,name:i.name,reason:Number.isFinite(i.return20)?`20日涨幅${i.return20}%超过上限${maxRunup}%`:'未取得20交易日历史价格，不能核验涨幅条件'}));
 const candidates=rankedAssessed.filter(i=>!excluded.some(e=>e.symbol===i.symbol)).sort((a,b)=>{
   if(ranked.status.active)return (a.modelRanking?.rank??999)-(b.modelRanking?.rank??999)||b.priority-a.priority;
   return b.priority-a.priority||a.symbol.localeCompare(b.symbol);
 }).slice(0,8);
 const coverage={marketSample:market.rows.length,marketTotal:market.total,marketPages:market.pages,requestedAnnouncements:announcementLimit,
   announcements:feed.items.length,announcementPages:feed.pages,announcementFailedPages:feed.failedPages,uniqueStocks:grouped.size,titleMatches:titleMatches.length,
   researched:selected.length,withAnnouncements:checked.filter(x=>x.ok).length,failed:checked.filter(x=>!x.ok).length,
   fullBodies:checked.filter(x=>x.ok).reduce((n,x)=>n+x.value.evidence.filter(e=>e.bodyRead).length,0),assessed:assessed.length,
   oldestPublication:items.map(i=>i.publishedAt).sort()[0]||null,marketAvailable:marketResult.status==='fulfilled'};
 const result={schema:2,createdAt:new Date().toISOString(),window,risk,criteria,candidates,excluded,coverage,
   model:{...ranked.status,horizonDays:modelDays,candidateCount:assessed.length},
   answer:'本次依据公告原文、历史价格及可取得的财务资料形成线索。请核验事件兑现与市场预期差。',aiStatus:'未调用',
   limitation:'扫描最近公告，不等于覆盖全部股票或完整未来日历。正文优先核验40/60家公司，行情财务深入核验最多12家，展示最多8家；未核验公司不代表没有机会。'};
 if(candidates.length&&deps.ai){progress('生成受益逻辑与反面推演',0,1);try{result.answer=await deps.ai(result);result.aiStatus='AI推断，依据列出的原文片段'}catch{result.aiStatus='AI不可用，保留真实证据与规则结果'}}
 progress('保存研究报告',1,1);return result;
}
