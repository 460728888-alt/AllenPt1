const $ = s => document.querySelector(s);
const fmt = (n, d = 2) => Number.isFinite(n) ? Number(n).toFixed(d) : '暂无';
const money = n => Number.isFinite(n) ? (Math.abs(n)>=1e8?(n/1e8).toFixed(2)+'亿元':Math.round(n).toLocaleString()+'元') : '暂无';
const clamp = (n,min=0,max=100) => Math.max(min,Math.min(max,n));
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const aiText = value => esc(value).replace(/^\s*#{1,6}\s*/gm,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/^\s*[-*]\s+/gm,'• ');
let currentUser = null;
const defaultFees={commissionRatePer10000:2.5,minimumCommission:5,stampDutyRatePer10000:5,transferFeeRatePer10000:0.1};
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(`allen_${currentUser?.username||'guest'}_${k}`)) ?? fallback; } catch { return fallback; } },
  set(k, v) { localStorage.setItem(`allen_${currentUser?.username||'guest'}_${k}`, JSON.stringify(v));if(['watch','portfolio','theses','feeSettings'].includes(k))scheduleCloudSave() }
};
const seedWatch = [
  {symbol:'601138.SS',code:'601138',name:'工业富联'},
  {symbol:'000977.SZ',code:'000977',name:'浪潮信息'},
  {symbol:'688981.SS',code:'688981',name:'中芯国际'},
  {symbol:'300750.SZ',code:'300750',name:'宁德时代'},
  {symbol:'0700.HK',code:'00700',name:'腾讯控股'}
];
const state = {
  page:'dashboard', stock:null, tab:'conclusion', loading:false,
  watch:store.get('watch', seedWatch),
  portfolio:store.get('portfolio', []),
  theses:store.get('theses', []),
  aiMessages:store.get('aiMessages',[]), aiScreen:null, volumeScreen:null, volumeScreenPolling:null, prediction:null, predictionView:'structure', predictionHistory:[], predictionScorecard:null, modelStatus:null,
  aiScreenCriteria:{horizon:'中期',risk:'中',capital:''},
  feeSettings:store.get('feeSettings',defaultFees), calculatorResult:null
};
const nav = [
  ['dashboard','⌂','今日机会'],['evolution','◈','机会演化图'],['validation','◇','验证与限制'],['legacyDashboard','▤','经典概览'],['watchlist','★','我的股票池'],['search','⌕','股票搜索'],['aiChat','✦','AI 研究对话'],['aiScreen','◈','未来机会雷达'],['volumeScreen','◉','量价机会筛选'],['prediction','⌁','趋势预测中心'],['decisions','◎','AI 买卖决策'],
  ['risks','△','风险预警中心'],['events','□','未来事件中心'],['portfolio','▣','我的持仓'],['calculator','¥','盈亏计算器'],['theses','✎','我的投资逻辑'],['brief','☀','每日 AI 简报'],['settings','⚙','系统设置']
];
const adminNav=['admin','♙','用户管理'];
const pageMeta = Object.fromEntries([...nav,adminNav].map(x => [x[0],x[2]]));
function loadUserState(){resetWorkbenchState();state.aiScreen=null;state.volumeScreen=null;state.volumeScreenPolling=null;state.radarArchive=[];state.researchJournal=[];state.radarPolling=null;state.watch=store.get('watch',seedWatch);state.portfolio=store.get('portfolio',[]);state.theses=store.get('theses',[]);state.aiMessages=store.get('aiMessages',[]);state.aiScreenCriteria=store.get('aiScreenCriteria',{horizon:'中期',risk:'中',capital:''});state.feeSettings={...defaultFees,...store.get('feeSettings',defaultFees)}}
let cloudSaveTimer=null;
function userStatePayload(){return {watch:state.watch,portfolio:state.portfolio,theses:state.theses,feeSettings:state.feeSettings}}
function scheduleCloudSave(){if(!currentUser)return;clearTimeout(cloudSaveTimer);cloudSaveTimer=setTimeout(()=>api('/api/user-state',{method:'PUT',body:JSON.stringify(userStatePayload())}).catch(()=>{}),700)}
async function loadCloudState(){const result=await api('/api/user-state');if(result.state){state.watch=result.state.watch||[];state.portfolio=result.state.portfolio||[];state.theses=result.state.theses||[];state.feeSettings={...defaultFees,...(result.state.feeSettings||{})};store.set('feeSettings',state.feeSettings)}else await api('/api/user-state',{method:'PUT',body:JSON.stringify(userStatePayload())})}

async function api(url, options={}) {
  const res = await fetch(url,{...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'),{status:res.status});
  return data;
}
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2400)}
function badge(score){if(!Number.isFinite(score))return ['yellow','数据未判定'];return score>=80?['green','重点关注']:score>=60?['yellow','等待更好机会']:score>=40?['orange','谨慎观察']:['red','风险较高']}
const navById=Object.fromEntries(nav.map(item=>[item[0],item]));
function navButton(item){const [id,icon,name]=item;return `<button class="nav-btn ${state.page===id?'active':''}" data-page="${id}"><span class="nav-icon">${icon}</span><span>${name}</span></button>`}
function navGroup(title,items){const open=items.some(([id])=>id===state.page);return `<details class="nav-group" ${open?'open':''}><summary><span>${title}</span><span class="nav-chevron">⌄</span></summary><div>${items.map(navButton).join('')}</div></details>`}
function navRender(){
  const pick=ids=>ids.map(id=>navById[id]).filter(Boolean);
  const management=currentUser?.role==='admin'?[adminNav,navById.settings]:[navById.settings];
  $('#nav').innerHTML=`<div class="nav-label">常用</div>${pick(['dashboard','evolution','watchlist','search','portfolio']).map(navButton).join('')}${navGroup('AI 研究',pick(['aiChat','aiScreen','volumeScreen','prediction']))}${navGroup('研究工具',pick(['decisions','risks','events','calculator','theses','brief','validation','legacyDashboard']))}${navGroup('管理与设置',management)}`;
}
function go(page){state.page=page;document.body.classList.toggle('dashboard-mode',page==='legacyDashboard');navRender();$('#breadcrumb').textContent=page==='dashboard'?'ALLEN STOCK / TODAY':'ALLEN STOCK / '+page.toUpperCase();$('#pageTitle').textContent=pageMeta[page]||'股票详情';$('.sidebar').classList.remove('open');render()}

async function quote(symbol){return api('/api/stock/'+encodeURIComponent(symbol))}
async function quoteMany(items){return Promise.all(items.map(async x=>{try{return {...x,...await quote(x.symbol)}}catch{return {...x,unavailable:true}}}))}
function stockTable(rows, withRemove=false){return `<div class="table-wrap"><table class="table"><thead><tr><th>股票</th><th>当前价格</th><th>今日涨跌</th><th>AI评分</th><th>当前状态</th><th>风险</th><th>操作</th></tr></thead><tbody>${rows.map(x=>{const [c,t]=badge(x.technical?.score??null);const ch=x.changePct;return `<tr><td><div class="stock-title">${x.name}</div><div class="stock-code">${x.code||x.symbol}</div></td><td>${x.unavailable?'暂无':fmt(x.price)} ${x.currency||''}</td><td class="${ch>=0?'up':'down'}">${Number.isFinite(ch)?(ch>=0?'+':'')+fmt(ch)+'%':'暂无'}</td><td><b>${x.technical?.score??'—'}</b></td><td><span class="badge ${c}">${t}</span></td><td><span class="badge ${x.technical?.score<50?'red':'yellow'}">${x.technical?.score<50?'高':'中'}</span></td><td><button class="link" data-stock="${x.symbol}" data-name="${x.name}">分析</button>${withRemove?` · <button class="link" data-remove="${x.symbol}">移除</button>`:''}</td></tr>`}).join('')}</tbody></table></div>`}
function loading(){return '<div class="card empty">正在读取真实行情…</div>'}

const allenToday=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
function opportunityDates(ideas,start=allenToday(),days=30){
 const end=new Date(Date.parse(start+'T00:00:00Z')+days*86400000).toISOString().slice(0,10),seen=new Set();
 return ideas.flatMap(idea=>(idea.evidence||[]).filter(e=>!e.negative&&e.bodyRead).flatMap(e=>(e.eventDates||[]).filter(d=>d.date>=start&&d.date<=end).map(d=>({...d,name:idea.name,symbol:idea.symbol,title:e.title,link:e.link})))).filter(d=>{const key=[d.symbol,d.date,d.title].join('|');if(seen.has(key))return false;seen.add(key);return true}).sort((a,b)=>a.date.localeCompare(b.date));
}
function opportunityMap(ideas,start=allenToday(),days=30){
 const dates=opportunityDates(ideas,start,days);
 return `<section class="card allen-map"><div class="section-head"><div><span class="badge blue">未来${days}天</span><h2>机会时间地图</h2></div><button data-go="events">事件中心 →</button></div><p class="muted">原文计划日期 · ${esc(start)}起 · 仅涵盖当前报告或你的研究卡，计划仍需确认。</p><div class="allen-timeline">${dates.slice(0,12).map(d=>`<article><time>${esc(d.date)}</time><h3>${esc(d.name)}</h3><p>${esc(d.title)}</p><details><summary>日期依据</summary><blockquote>${esc(d.passage)}</blockquote><a href="${esc(d.link)}" target="_blank" rel="noopener">核验原文</a></details><button data-stock="${esc(d.symbol)}">研究公司</button></article>`).join('')||'<p>暂无已取得正文且有明确日期的未来事件。先进入机会雷达发现线索。</p>'}</div>${dates.length>12?`<small>另有${dates.length-12}条，请到事件中心查看。</small>`:''}</section>`;
}
function allenChanges(items,rows=[],today=allenToday()){
 const changes=[];
 for(const j of items){
  const note=(j.notes||[]).at(-1);
  if(note)changes.push({priority:j.status==='逻辑失效'?0:1,at:note.at,name:j.idea.name,title:'我的判断更新：'+note.status,detail:note.note});
  if(j.status!=='完成复盘'&&j.status!=='逻辑失效'&&j.window.end<=today)changes.push({priority:1,at:j.window.end,name:j.idea.name,title:'研究窗口到期，等待复核',detail:'核对事件是否兑现；到期并不代表判断成功。'});
  const check=(j.checks||[]).at(-1);
  if(check&&Number.isFinite(check.changeFromBaseline))changes.push({priority:2,at:check.at,name:j.idea.name,title:'价格快照更新',detail:`较原报告 ${signed(check.changeFromBaseline)}，价格变化不能证明事件兑现。`});
 }
 for(const r of rows)if(Number.isFinite(r.signalChange?.scoreDelta)&&r.signalChange.scoreDelta!==0)changes.push({priority:3,at:today,name:r.name,title:'技术条件变化',detail:`评分较上次 ${r.signalChange.scoreDelta>0?'+':''}${r.signalChange.scoreDelta}，需结合公告核验。`});
 return changes.sort((a,b)=>a.priority-b.priority||String(b.at).localeCompare(String(a.at))).slice(0,3);
}
function allenScorecard(items){
 const finished=items.filter(j=>j.status==='完成复盘'),failed=items.filter(j=>j.status==='逻辑失效'),due=items.filter(j=>!['完成复盘','逻辑失效'].includes(j.status)&&j.window.end<=allenToday());
 return `<section class="card allen-scorecard"><div class="section-head"><h2>Allen 判断成绩单</h2><button data-go="theses">逐条复核 →</button></div><div class="allen-metrics"><span><b>${items.length}</b>全部研究卡</span><span><b>${finished.length}</b>完成复盘</span><span><b>${failed.length}</b>标记逻辑失效</span><span><b>${due.length}</b>到期未复核</span></div><p class="muted">复盘状态由你记录，完成不等于正确。下表包含全部状态；尚未形成经验证的预测胜率。</p><div class="table-wrap"><table class="table"><thead><tr><th>原始判断</th><th>窗口截止</th><th>复核状态</th><th>最新快照变化</th></tr></thead><tbody>${items.map(j=>`<tr><td>${esc(j.idea.name)}<small class="score-reason">${esc(j.idea.rationale)}</small></td><td>${esc(j.window.end)}</td><td>${esc(j.status)}</td><td>${signed(j.checks?.at(-1)?.changeFromBaseline)}<small class="score-reason">${j.checks?.length?dateTime(j.checks.at(-1).at):'尚未更新'}</small></td></tr>`).join('')||'<tr><td colspan="4">还没有记录。从机会卡开始，保留第一份判断。</td></tr>'}</tbody></table></div><small>快照变化不是到期收益或实盘收益，不含费用、分红及复权调整。</small></section>`;
}
function costView(stock){
 const holding=state.portfolio.find(p=>p.symbol===stock?.symbol);
 if(!holding)return '<section class="allen-cost"><b>我的成本视角</b><p>记录持仓后，把价格情景换成你自己的预计净盈亏。</p><button data-go="portfolio">记录持仓 →</button></section>';
 const scenarios=[['当前价',stock.price],['防守参考',stock.tradePlan?.defensePrice],['第一目标参考',stock.tradePlan?.target1]];
 return `<section class="allen-cost"><h3>我的成本视角</h3><p>买入价 ${fmt(Number(holding.buy))} · ${esc(holding.qty)}股</p><div class="allen-metrics">${scenarios.map(([label,price])=>{const valid=Number.isFinite(price)&&price>0&&Number(holding.buy)>0&&Number(holding.qty)>0;const profit=valid?calculateTrade({buyPrice:Number(holding.buy),qty:Number(holding.qty),sellPrice:price},state.feeSettings).profit:null;return `<span>${label} · ${fmt(price)}<b class="${profit>=0?'up':'down'}">${yuan(profit)}</b>预计净盈亏</span>`}).join('')}</div><small>按个人费率估算一次买卖；参考价不是承诺成交价。</small><button data-go="calculator">调整费率与情景 →</button></section>`;
}
function opportunityBrief(idea,window){
 const dates=opportunityDates([idea],window.start,window.days||30);
 return `<section class="allen-idea-brief"><span class="badge blue">Allen 机会卡</span><h3>先看懂这条机会</h3><dl><dt>为什么关注</dt><dd>${esc(idea.rationale)}</dd><dt>预计何时</dt><dd>${dates.length?dates.map(d=>esc(d.date)).join('、'):'尚无可核验的窗口内日期'}</dd><dt>下一步确认</dt><dd>核对计划是否落实，并寻找实际交付、订单、收入或客户反馈。</dd><dt>改变判断的条件</dt><dd>${esc(idea.invalidation)}</dd></dl><p class="muted">受益逻辑是待验证假设。下面保留价格反应与原始证据。</p></section>`;
}
async function legacyDashboard(){
  const owner=currentUser;document.body.classList.add('dashboard-mode');$('#content').innerHTML=loading();
  let rows=await quoteMany(state.watch.slice(0,8));
  try{const payload=rows.filter(x=>!x.unavailable&&x.data?.state==='ok'&&Number.isFinite(x.technical?.score)).map(x=>({symbol:x.symbol,name:x.name,score:x.technical.score,status:badge(x.technical.score)[1],price:x.price}));const saved=await api('/api/signals/snapshot',{method:'POST',body:JSON.stringify({items:payload})});const map=new Map((saved.changes||[]).map(x=>[x.symbol,x]));rows=rows.map(x=>({...x,signalChange:map.get(x.symbol)}))}catch{}
  const riskRows=rows.filter(x=>(x.technical?.score??60)<50).sort((a,b)=>(a.technical?.score??60)-(b.technical?.score??60)),focus=riskRows[0]||rows[0];
  const risks=riskRows.length,positives=rows.filter(x=>(x.changePct??0)>1).length,waiting=Math.max(0,rows.length-positives-risks);
  let research=null;if(focus)try{research=await api('/api/research/'+encodeURIComponent(focus.symbol))}catch{}
  const f=research?.finance,p=focus?.tradePlan,t=focus?.technical||{},score=t.score??null,[scoreTone,scoreLabel]=badge(score);
  const growth=Number.isFinite(f?.profitGrowth)?clamp(55+f.profitGrowth/2):null,quality=Number.isFinite(f?.netMargin)?clamp(55+f.netMargin):null,financeSafe=Number.isFinite(f?.debtRatio)?clamp(100-f.debtRatio):null;
  const dimensions=[['净利率（%）',f?.netMargin,'披露净利率，不等于公司质量评分'],['行业归属',null,research?.company?.industry||'行业资料未取得'],['利润同比（%）',f?.profitGrowth,'披露增速，不是未来成长预测'],['资产负债率（%）',f?.debtRatio,'披露比例，不等于全部财务风险'],['估值判断',null,'需要同业与历史估值，不凭价格猜测']];
  const announcements=(research?.announcements||[]).slice(0,3);
  const hour=new Date().getHours(),greeting=hour<11?'早上好':hour<18?'下午好':'晚上好';
  const delta=focus?.signalChange?.scoreDelta;
  let journal=[],journalError=false;try{journal=(await api('/api/radar/journal')).items||[]}catch{journalError=true}
  if(currentUser!==owner||state.page!=='legacyDashboard')return;
  const changes=allenChanges(journal,rows);
  const moduleTarget=focus?`data-stock="${focus.symbol}" data-name="${esc(focus.name)}"`:'data-go="search"';
  $('#content').innerHTML=`<section class="command-banner"><div><p class="eyebrow">PRIVATE INVESTMENT INTELLIGENCE</p><h2>${greeting}，${esc(currentUser?.displayName||'Allen')}</h2><p>提前研究未来变化，持续验证每一次判断</p></div><div class="pool-overview"><b>我的股票池</b><div><span><strong>${state.watch.length}</strong>关注股票</span><span class="good"><strong>${positives}</strong>积极变化</span><span class="warn"><strong>${waiting}</strong>等待条件</span><span class="danger"><strong>${risks}</strong>高风险</span></div></div><div class="banner-events"><b>今日先看</b><p>${focus?`${esc(focus.name)}：${risks?'优先检查风险':'查看最新变化'}`:'先添加关注股票'}</p>${focus?`<button data-stock="${focus.symbol}" data-name="${esc(focus.name)}">打开研究报告 →</button>`:'<button data-go="search">搜索股票 →</button>'}</div></section>
  <section class="allen-today card"><div class="section-head"><div><span class="badge blue">Allen 今日先看</span><h2>今天最值得复核的3条变化</h2></div><button class="primary" data-go="aiScreen">发现未来机会 →</button></div><p class="muted">优先展示失效、到期及最近记录，不代表这些事件都在今天发生。</p>${journalError?'<p>研究卡暂时读取失败，请刷新重试。</p>':''}<div class="allen-change-grid">${changes.map(c=>`<article><small>${dateTime(c.at)}</small><h3>${esc(c.name)}</h3><b>${esc(c.title)}</b><p>${esc(c.detail)}</p><button data-go="theses">查看与复核 →</button></article>`).join('')||'<p>暂无已记录变化。先发现机会并加入研究卡，不用示例消息填充。</p>'}</div></section>
  <div class="research-console"><aside class="watch-rail"><button class="stock-search" data-go="search">⌕ 搜索股票代码或名称</button><div class="rail-title"><b>我的股票池</b><button data-go="watchlist">全部</button></div>${rows.map(x=>{const change=x.signalChange?.scoreDelta;return `<button class="rail-stock ${x.symbol===focus?.symbol?'active':''}" data-stock="${x.symbol}" data-name="${esc(x.name)}"><span class="stock-avatar">${esc(x.name.slice(0,1))}</span><span><b>${esc(x.name)}</b><small>${esc(x.code||x.symbol)} · 评分 ${x.technical?.score??'—'}${Number.isFinite(change)?` (${change>=0?'+':''}${change})`:''}</small></span><strong class="${(x.changePct||0)>=0?'up':'down'}">${Number.isFinite(x.changePct)?`${x.changePct>=0?'+':''}${fmt(x.changePct)}%`:'暂无'}</strong></button>`}).join('')||'<div class="empty">还没有关注股票</div>'}<button class="rail-add" data-go="search">＋ 添加股票</button></aside>
  <section class="focus-research card"><div class="focus-heading"><div><p class="eyebrow">${esc(focus?.symbol||'')}</p><h2>${esc(focus?.name||'选择一只股票')}</h2><div class="focus-price">${fmt(focus?.price)} <span class="${(focus?.changePct||0)>=0?'up':'down'}">${Number.isFinite(focus?.changePct)?`${focus.changePct>=0?'+':''}${fmt(focus.changePct)}%`:''}</span></div><small>真实行情 · 可能存在延迟</small></div><div class="focus-score"><span>技术条件评分</span><b>${score}</b><small>/100 · ${scoreLabel}</small>${Number.isFinite(delta)?`<em class="${delta>=0?'up':'down'}">较上次 ${delta>=0?'+':''}${delta}</em>`:'<em>开始记录评分变化</em>'}</div></div><div class="mini-tabs"><span class="active">概览</span><span>公司分析</span><span>财务分析</span><span>行业分析</span><span>风险分析</span><span>AI 决策</span></div><div class="chart-stage"><div class="chart-label">最近90日价格走势</div>${spark(focus?.history)}<div class="chart-baseline"></div></div>${actionSummaryHtml(focus)}${costView(focus)}</section>
  <aside class="right-research">${opportunityMap(journal.filter(j=>j.status!=='逻辑失效'&&j.status!=='完成复盘').map(j=>j.idea))}<section class="card core-card"><div class="section-head"><h2>💡 核心结论</h2><span class="badge ${scoreTone}">${scoreLabel}</span></div><p>${focus?`${esc(focus.name)}当前技术条件评分 ${score}/100。${t.ma5>t.ma20?'短期价格结构改善':'短期仍需等待确认'}，行动前继续核验财务与公告。`:'请先选择股票。'}</p>${dimensions.map(([name,value,detail],i)=>`<div class="dimension-row"><i class="d${i}"></i><span><b>${name}</b><small>${esc(detail)}</small></span><strong>${Number.isFinite(value)?Math.round(value):'—'}</strong></div>`).join('')}</section><section class="card compact-events"><h2>📅 最新重要事件</h2>${announcements.length?announcements.map(a=>`<a href="${a.link}" target="_blank" rel="noopener"><span>${esc(a.date?.slice(5)||'近期')}</span><b>${esc(a.title)}</b></a>`).join(''):'<p class="muted">暂未取得可核验公告</p>'}</section></aside></div>
  <section class="research-modules">${[['公司研究','主营业务、竞争力与发展战略',research?.company?.industry||'公司资料'],['财务分析','营收、利润、现金流与负债',Number.isFinite(f?.profitGrowth)?`利润同比 ${signed(f.profitGrowth)}`:'财务待核验'],['行业分析','行业趋势、需求与竞争格局',research?.company?.industry||'行业待识别'],['风险雷达','财务、估值与价格风险',risks?`${risks} 只需优先检查`:'暂无高风险信号'],['市场情绪','近期波动与相对强弱',Number.isFinite(focus?.changePct)?`今日 ${signed(focus.changePct)}`:'行情待核验'],['技术走势','趋势、成交量与关键位置',t.ma5>t.ma20?'短期结构改善':'等待趋势确认']].map(([name,desc,value],i)=>`<button class="module-card m${i}" ${moduleTarget}><span>${['◉','▤','◈','△','◇','⌁'][i]}</span><div><b>${name}</b><small>${desc}</small><em>${esc(value)}</em></div></button>`).join('')}</section><section class="decision-dock"><div><span class="decision-logo">◎</span><div><b>AI 投资决策中心</b><small>把研究结果转化为可验证的行动条件</small></div></div><button data-go="decisions"><span>入场时机</span><b>${esc(p?.status||'等待核验')}</b></button><button data-go="portfolio"><span>持有建议</span><b>${state.portfolio.length?'检查个人持仓':'尚未记录持仓'}</b></button><button data-go="prediction"><span>情景研究</span><b>查看历史条件与限制</b></button><button data-go="risks"><span>关注重点</span><b>${risks?'先处理风险':'等待更好机会'}</b></button></section>${disclaimer()}`;
}
async function watchlist(){ $('#content').innerHTML=loading();const rows=await quoteMany(state.watch);$('#content').innerHTML=`<div class="section-head"><div><h2>我的股票池</h2><p class="muted">追踪真实行情与综合条件</p></div><button class="primary" data-go="search">＋ 添加股票</button></div><div class="card">${stockTable(rows,true)}</div>${disclaimer()}` }
function searchPage(){ $('#content').innerHTML=`<div class="card"><h2>搜索股票</h2><p class="muted">支持股票名称、A股代码、港股代码和美股代码</p><form id="searchForm" class="searchbox"><input id="searchInput" class="input" placeholder="例如：工业富联、601138、AAPL"><button class="primary">搜索</button></form></div><div id="searchResults" class="section"></div>${disclaimer()}` }
async function doSearch(q){const box=$('#searchResults');box.innerHTML=loading();try{const data=await api('/api/search?q='+encodeURIComponent(q));box.innerHTML=`<div class="card"><h2>搜索结果</h2>${data.quotes.length?`<div class="table-wrap"><table class="table"><thead><tr><th>名称</th><th>代码</th><th>市场</th><th>操作</th></tr></thead><tbody>${data.quotes.map(x=>`<tr><td><b>${x.name}</b></td><td>${x.symbol}</td><td>${x.exchange}</td><td><button class="secondary" data-add="${x.symbol}" data-name="${x.name}">加入股票池</button> <button class="link" data-stock="${x.symbol}" data-name="${x.name}">立即分析</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">没有找到匹配股票</div>'}</div>`}catch(e){box.innerHTML=`<div class="card empty">${e.message}</div>`}}

function aiMessagesHtml(){return state.aiMessages.length?state.aiMessages.map(item=>`<div class="chat-message ${item.role}"><div class="chat-role">${item.role==='user'?'我':'Allen AI'}</div><div class="chat-text">${aiText(item.content)}</div></div>`).join(''):'<div class="empty">输入股票代码和问题，AI 会先读取真实行情再回答。</div>'}
async function aiChatPage(){let status={configured:false,provider:'AI'};try{status=await api('/api/ai/status')}catch{}$('#content').innerHTML=`<div class="section-head"><div><h2>✦ AI 股票研究对话</h2><p class="muted">结合真实行情连续提问 · ${status.configured?status.provider+' 已连接':'AI 接口待管理员配置'}</p></div><button class="ghost" data-clear-chat>清空对话</button></div><div class="ai-layout"><div class="card chat-panel"><div id="chatMessages" class="chat-messages">${aiMessagesHtml()}</div><form id="aiChatForm" class="chat-form"><input class="input" name="symbol" maxlength="12" placeholder="股票代码，例如 601138"><textarea name="question" required maxlength="1200" placeholder="例如：工业富联当前有哪些机会和风险？"></textarea><button class="primary" type="submit">发送给 AI</button></form></div><div class="card"><h2>可以这样问</h2>${['现在处于什么趋势？','当前最大的风险是什么？','什么条件满足后更值得关注？','短期和中期判断有什么不同？'].map(q=>`<button class="suggestion" data-ai-question="${q}">${q}</button>`).join('')}<p class="note section">AI 只能使用已核验行情，不会读取你的国信证券账户，也不会替你下单。</p></div></div>${disclaimer()}`;setTimeout(()=>{const box=$('#chatMessages');if(box)box.scrollTop=box.scrollHeight},0)}

function modelStatusHtml(status=state.modelStatus){
 if(!status)return'';
 const active=status.active,metrics=(status.horizons||[]).filter(x=>x.metrics),enabled=(status.activeHorizons||[]).join(' / ');
 return `<section class="card model-status ${active?'ready':'pending'}"><div class="section-head"><div><span class="badge ${active?'green':'yellow'}">${active?'部分周期已启用':'安全回退中'}</span><h2>LightGBM 股票排序引擎</h2></div><b>${esc(status.version||'等待训练')}</b></div><p>${esc(status.message||'')}</p><div class="model-metrics"><span>训练样本 <b>${Number(status.trainingRows||0).toLocaleString()}</b></span><span>股票范围 <b>${Number(status.universeSize||0).toLocaleString()}</b></span><span>数据截至 <b>${esc(status.dataThrough||'未知')}</b></span><span>启用周期 <b>${esc(enabled||'无')}</b></span></div>${metrics.length?`<details><summary>查看滚动时间外验证</summary>${metrics.map(x=>`<p>${x.days}日：净胜率 ${fmt(x.metrics.topDecileNetHitRate??x.metrics.topDecileHitRate,1)}% · 扣费后平均超额 ${signed(x.metrics.topDecileNetMeanExcess??x.metrics.topDecileMeanExcess)} · <b>${x.approved?'通过':x.metrics.approved?'通过':'未通过'}</b></p>`).join('')}<p class="muted">交易成本与验证折数以模型清单记录为准；历史结果不代表未来。</p></details>`:''}${!active?'<p class="warning">当前不输出机器学习排序：可能是数据过旧，或该周期未通过验证。系统继续使用公告证据和价格规则。</p>':''}<p class="footer-note">排序只决定先研究谁；正式入场仍需公告确认、价格结构和至少1.5倍风险收益比。</p></section>`;
}
function radarIdeaCard(idea,i,window){
 const life=idea.lifecycle,breakdown=idea.rankBreakdown||{};
 const lifecycle=life?`<div class="radar-life"><span class="badge ${life.status==='需要复核'?'orange':life.stage==='本次新发现'?'green':'blue'}">${esc(life.stage)}</span><b>${esc(life.status)}</b><small>首次发现 ${dateTime(life.firstSeenAt)} · 保留至 ${esc(life.validUntil||'待确认')}</small><p>${esc(life.reason)}</p></div>`:'';
 return `<article class="card radar-candidate">${lifecycle}<div class="section-head"><div><small>稳定研究序号 ${i+1} · 不是收益排名</small><h2>${esc(idea.name)} <small>${esc(idea.code)}</small></h2><span class="badge blue">${esc(idea.group)}</span></div><button data-radar-follow="${esc(idea.symbol)}">＋ 跟踪这条逻辑</button></div>${opportunityBrief(idea,window)}<h3>为什么进入视野</h3><p>${esc(idea.rationale)}</p><h3>是否已经涨过</h3><p>${esc(idea.pricedIn)}</p><p class="muted">60交易日价格变化：${signed(idea.return60)} · 行情时间：${dateTime(idea.quoteAt)}</p><h3>兑现基础</h3><p>${esc(idea.company?.industry||'行业资料未取得')} · 利润同比 ${signed(idea.finance?.profitGrowth)} · 营收同比 ${signed(idea.finance?.revenueGrowth)}</p><small>财务报告期：${esc(idea.finance?.reportDate||'未知')}</small>${(idea.evidence||[]).map(e=>`<details class="radar-evidence"><summary>${e.negative?'⚠ 反面线索':'▤ 原始证据'} · ${esc(e.title)}</summary><p>发布日期：${dateTime(e.publishedAt)}；公告标注日期：${esc(e.date)}</p><p>${e.bodyRead?(e.bodyTruncated?'已读取部分正文，须打开原文确认':'已读取来源提供的正文'):'正文不可用，仅保留标题，不能据此确认事件'}</p>${(e.eventDates||[]).map(d=>`<p class="badge ${d.inWindow?'blue':'orange'}">计划日期 ${esc(d.date)} · ${d.inWindow?'窗口内':'窗口外'}</p><blockquote>${esc(d.passage)}</blockquote>`).join('')}${!(e.eventDates||[]).length?'<p>未提取到有完整年月日的未来计划；相对期限不自动推算。</p>':''}<h4>可能受益的原文</h4>${(e.benefitPassages||[]).map(p=>`<blockquote>${esc(p)}</blockquote>`).join('')||'<p>未提取到明确受益片段</p>'}<h4>风险与时间限制的原文</h4>${[...(e.riskPassages||[]),...(e.timingPassages||[])].map(p=>`<blockquote>${esc(p)}</blockquote>`).join('')||'<p>未提取到风险片段，不代表没有风险</p>'}<a href="${esc(e.link)}" target="_blank" rel="noopener">打开原公告</a></details>`).join('')}<h3>什么情况下不再看好</h3><p>${esc(idea.invalidation)}</p><details><summary>查看排序依据与信息缺口</summary><p>窗口证据 ${breakdown.windowEvidence??'—'}；正文 ${breakdown.bodyEvidence??'—'}；负面标题 ${breakdown.negativeEvidence??'—'}；已涨惩罚 ${breakdown.alreadyRisen??'—'}；利润变化 ${breakdown.profitChange??'—'}。这是公开的规则分，不是概率。</p><p>${esc(idea.unknowns)}</p></details><button data-stock="${esc(idea.symbol)}" data-name="${esc(idea.name)}">完整公司研究 →</button></article>`;
}
function radarGroup(title,items,window,start=0,empty='暂无'){return `<section class="radar-life-group"><div class="section-head"><div><h2>${title}</h2><p class="muted">${title==='本次新发现'?'这次扫描首次进入研究池':'排名变化不会使未到期机会消失'}</p></div><b>${items.length}只</b></div><div class="radar-grid">${items.map((idea,i)=>radarIdeaCard(idea,start+i,window)).join('')||`<div class="card empty">${empty}</div>`}</div></section>`}
function radarReportV2(r){
 const c=r.coverage,all=r.candidates||[];
 const fresh=Array.isArray(r.newCandidates)?r.newCandidates:all;
 const continuing=Array.isArray(r.continuingCandidates)?r.continuingCandidates:[];
 const life=r.lifecycle||{active:all.length,new:fresh.length,continuing:continuing.length,expired:[]};
 return `${storageStateHtml(r.storage)}${r.dataState==='unable_to_judge'?'<section class="card warning"><h2>无法完成行情判断</h2><p>行情全部失败或不足，不能解释为没有机会。</p></section>':r.dataState==='partial'?'<p class="warning">部分数据未完成核验，其余范围未知。</p>':''}<div class="card radar-summary"><span class="badge blue">Allen 证据优先</span><h2>稳定机会池</h2><p>${esc(r.window.start)} 至 ${esc(r.window.end)} · ${esc(r.risk)}风险偏好 · ${dateTime(r.createdAt)}</p><div class="grid g4"><div><b>${c.announcements}</b><p>本次公告</p></div><div><b>${life.new}</b><p>新发现</p></div><div><b>${life.continuing}</b><p>持续跟踪</p></div><div><b>${life.active}</b><p>当前有效机会</p></div></div><p class="footer-note">行情有效样本 ${c.marketSample}只；深入核验 ${c.assessed}只。候选不会因为下一次排名改变而消失，只会在事件完成、明确失效或跟踪期限结束后退出。 ${esc(r.limitation)}</p>${!r.durable?'<p class="badge orange">保存未成功：当前结果未持久留档</p>':''}</div><details class="card"><summary>数据请求与缺口</summary><p>股票行情请求 ${c.stockRequests?.requested??'未知'}，返回 ${c.stockRequests?.returned??'未知'}，失败 ${c.stockRequests?.failed??'未知'}，可判断 ${c.stockRequests?.usable??'未知'}</p><p>公告正文请求 ${c.bodyRequests?.requested??'未知'}，失败 ${c.bodyRequests?.failed??'未知'}</p><p>公告分页失败 ${c.announcementFailedPages??'未知'}；行情分页失败 ${c.marketPageCoverage?.failed??'未知'}</p>${[...(c.stockRequests?.failures||[]),...(c.bodyRequests?.failures||[])].map(f=>`<p>${esc(f.symbol||f.id||'')}：${esc(f.message)}</p>`).join('')}${(c.stockRequests?.gaps||[]).map(g=>`<p>${esc(g.symbol)}：${esc((g.reasons||[]).join('；'))}</p>`).join('')}</details>${opportunityMap(all,r.window.start,r.window.days||30)}${radarGroup('本次新发现',fresh,r.window,0,r.dataState==='unable_to_judge'?'无法完成判断':r.dataState==='partial'?'已核验范围未发现新增候选，其余范围未知':'本次没有新增机会')}${radarGroup('持续跟踪',continuing,r.window,fresh.length,'还没有需要延续的旧机会')}<div class="card"><h2>AI受益链与反面推演</h2><p class="muted">${esc(r.aiStatus)}</p><div class="chat-text">${aiText(r.answer)}</div></div>${r.excluded.length?`<div class="card"><h3>本次扫描为什么没有选它们</h3>${r.excluded.map(e=>`<p>${esc(e.name)}：${esc(e.reason)}</p>`).join('')}</div>`:''}`;
}
async function pollRadar(jobId,owner){
 if(state.radarPolling===jobId)return;
 state.radarPolling=jobId;
 try{
  while(currentUser===owner&&state.page==='aiScreen'){
   const job=await api('/api/ai/radar-jobs/'+encodeURIComponent(jobId));
   if(currentUser!==owner||state.page!=='aiScreen')return;
   if(job.status==='done'){state.aiScreen=job.result;state.radarPolling=null;await aiScreenPage();return}
   if(job.status==='failed')throw Error(job.error);
   $('#screenResult').innerHTML=`<div class="card"><h2>${esc(job.stage)}</h2><progress max="${job.total||1}" value="${job.completed||0}"></progress><p>${job.completed||0} / ${job.total||1} · 分阶段处理，可能需要数分钟。</p><p class="muted">可切换本站页面后再回来查看；服务器重启会中断未完成任务。</p></div>`;
   await new Promise(resolve=>setTimeout(resolve,2500));
  }
 }catch(e){if(currentUser===owner&&state.page==='aiScreen')$('#screenResult').innerHTML=`<div class="card empty">${esc(e.message)}<p>可返回本页查看任务状态；若服务重启，先查看历史报告再重试。</p></div>`}
 finally{if(state.radarPolling===jobId)state.radarPolling=null;const button=$('#aiScreenForm button[type="submit"]');if(button)button.disabled=false}
}
async function researchJournalHtml(){
 const owner=currentUser;
 let payload;try{payload=await api('/api/radar/journal')}catch{return '<div class="card">研究卡暂时无法读取，请稍后重试。</div>'}
 if(currentUser!==owner)return '';
 state.researchJournal=payload.items;
 return `<section class="card allen-journal"><div class="section-head"><div><span class="badge blue">Allen研究卡</span><h2>从发现到验证</h2><p>保留最初的证据，逐条记录判断为什么改变。</p></div><button data-go="aiScreen">发现新线索 →</button></div>${!payload.durable?'<p class="badge orange">持久保存未确认</p>':''}${payload.items.map(j=>{const check=j.checks.at(-1);return `<details class="radar-evidence"><summary>${esc(j.idea.name)} · ${esc(j.status)} · 截止${esc(j.window.end)}</summary>${j.legacy?'<p>旧版记录，未重建为当时原始快照。</p>':''}${j.researchId?`<button data-research-history="${esc(j.researchId)}">查看原始快照及追加历史</button>`:''}<p>最初理由：${esc(j.idea.rationale||j.idea.group)}</p><p>失效条件：${esc(j.idea.invalidation)}</p><p>报告快照价格：${fmt(j.baselinePrice)}（${dateTime(j.baselineAt)}）</p><p>最新检查：${check?fmt(check.price)+' · 快照价格变化 '+signed(check.changeFromBaseline):'尚未检查'}</p><small>非实盘收益，不含费用、分红、复权变化和成交限制；价格变化不能证明逻辑兑现。</small><p><button data-journal-check="${esc(j.id)}">更新价格快照</button> <button data-stock="${esc(j.idea.symbol)}">重新研究</button></p><form class="journal-review" data-journal-id="${esc(j.id)}"><select class="input" name="status">${['跟踪中','需要复核','逻辑失效','完成复盘'].map(s=>`<option ${j.status===s?'selected':''}>${s}</option>`).join('')}</select><textarea class="input" required name="note" maxlength="1000" placeholder="新证据是什么？原先判断需要怎么调整？"></textarea><button type="submit">保存本次复核</button></form>${j.notes.map(n=>`<p>${dateTime(n.at)} · ${esc(n.status)}：${esc(n.note)}</p>`).join('')}</details>`}).join('')||'<p>还没有研究卡。在未来机会雷达里点击“跟踪这条逻辑”。</p>'}</section>`;
}
function radarReport(result){
 if(result.schema===2)return radarReportV2(result);
 const cards=(result.candidates||[]).map(c=>`<article class="card radar-candidate"><div class="section-head"><h3>${esc(c.name)} · ${esc(c.code)}</h3><span class="badge blue">${esc(c.group)}</span></div><p><strong>预期是否已反映？</strong> ${esc(c.pricedIn)}</p><ul>${c.evidence.map(e=>`<li><a href="${esc(e.link)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a><p class="muted">公告发布：${esc(e.date)} · ${e.eventDate?'标题计划日期：'+esc(e.eventDate):'事件日期未知'} · ${e.negative?'反面证据':esc(e.status)}</p></li>`).join('')}</ul><p><strong>失效条件：</strong>${esc(c.invalidation)}</p><p class="footer-note">${esc(c.unknowns)}</p><button data-stock="${esc(c.symbol)}">打开完整研究</button></article>`).join('');
 return `<div class="card"><h2>本期机会线索</h2><p>${esc(result.window.start)} → ${esc(result.window.end)} · ${esc(result.risk)}风险偏好 · ${esc(result.createdAt)}</p><p>行情样本 ${result.coverage.marketSample} 只 / 抽查 ${result.coverage.researched} 只 / 有公告 ${result.coverage.withAnnouncements} 只 / 无公告或失败 ${result.coverage.failed} 只</p><p class="footer-note">${esc(result.limitation)}</p>${!result.durable?'<p class="badge orange">当前结果未持久保存。</p>':''}</div><div class="radar-grid">${cards||'<div class="card empty">本次抽查没有找到符合规则的公告线索。没有候选不代表整个市场没有机会。</div>'}</div><div class="card"><h2>受益逻辑与反面推演</h2><p class="muted">${esc(result.aiStatus)}</p><div class="chat-text">${aiText(result.answer)}</div></div>`;
}
async function aiScreenPage(){
 const owner=currentUser,c=state.aiScreenCriteria||{};let archive={reports:[]},active={},archiveError='';
 try{[archive,active,state.modelStatus]=await Promise.all([api('/api/ai/radar-history'),api('/api/ai/radar-active'),api('/api/model/status')])}catch(error){archiveError=error.message}
 if(state.page!=='aiScreen'||currentUser!==owner)return;
 state.radarArchive=archive.reports;
 if(!state.aiScreen&&archive.reports?.length)state.aiScreen=archive.reports[0];
 $('#content').innerHTML=`<div class="card radar-intro"><span class="badge blue">Allen · 提前研究，事后验证</span><h2>未来机会雷达</h2><p>未来有什么变化 → 谁可能受益 → 是否已经涨过 → 什么会推翻判断。</p><form id="aiScreenForm" class="radar-filters"><label>未来窗口<select class="input" name="days">${[7,30,90].map(d=>`<option value="${d}" ${Number(c.days||30)===d?'selected':''}>未来${d}自然日</option>`).join('')}</select></label><label>公告扫描量<select class="input" name="announcementLimit">${[1000,3000].map(n=>`<option value="${n}" ${Number(c.announcementLimit||1000)===n?'selected':''}>最近${n}条公告</option>`).join('')}</select></label><label>事件方向<select class="input" name="eventType">${['全部','业绩变化','订单与项目','产品与技术','资本与股东'].map(s=>`<option ${(c.eventType||'全部')===s?'selected':''}>${s}</option>`).join('')}</select></label><label>风险偏好<select class="input" name="risk">${['低','中','高'].map(s=>`<option ${(c.risk||'中')===s?'selected':''}>${s}</option>`).join('')}</select></label><label>20交易日涨幅上限（%）<input class="input" type="number" name="maxRunup" min="0" max="200" value="${esc(c.maxRunup??30)}"></label><label>名称/代码/公告关键词<input class="input" name="keyword" maxlength="40" value="${esc(c.keyword||'')}" placeholder="例如：订单、半导体"></label><button class="primary" type="submit" ${active.jobId?'disabled':''}>扫描并核验证据</button></form><p class="footer-note">1000/3000是公告条数，不是股票数量。按事件筛选后读取40/60家公司正文，深入核验最多12家并展示最多8家；不再随机抽20只。没有历史价格的候选会标明未知，不视为通过涨幅核验。</p></div><div id="screenResult" class="section">${state.aiScreen?radarReport(state.aiScreen):'<div class="card empty">设置时间和事件方向，先看证据，再做判断。</div>'}</div><div class="card"><h3>我的原始报告</h3>${archiveError?`<p class="warning">记录暂不可读取：${esc(archiveError)}</p>`:''}${archive.reports.map((r,i)=>`<button data-radar-history="${i}">${dateTime(r.createdAt)} · ${r.window.days}天 · ${r.candidates.length}条</button>`).join(' ')||(archiveError?'':'暂无报告')}<p class="muted">旧版报告保持原样；新的报告不会覆盖原始记录。</p></div>${disclaimer()}`;
 if(state.modelStatus)$('#screenResult')?.insertAdjacentHTML('beforebegin',modelStatusHtml());
 if(active.jobId)void pollRadar(active.jobId,owner);
}

async function openStock(symbol,name){state.page='stock';document.body.classList.remove('dashboard-mode','workbench-mode');state.tab='conclusion';state.stock={symbol,name};navRender();$('#pageTitle').textContent='股票详情';$('#breadcrumb').textContent='RESEARCH / '+symbol;$('#content').innerHTML=loading();try{const [market,research]=await Promise.allSettled([quote(symbol),api('/api/research/'+encodeURIComponent(symbol))]);if(market.status!=='fulfilled')throw market.reason;let signalChange=null;try{const saved=await api('/api/signals/snapshot',{method:'POST',body:JSON.stringify({items:[{symbol:market.value.symbol,name:name||market.value.name,score:market.value.technical?.score??null,status:badge(market.value.technical?.score??null)[1],price:market.value.price}]})});signalChange=saved.changes?.[0]||null}catch{}state.stock={...state.stock,...market.value,research:research.status==='fulfilled'?research.value:null,signalChange};renderStock()}catch(e){$('#content').innerHTML=`<div class="card empty"><h2>行情暂不可用</h2><p>${e.message}</p><button class="secondary" data-go="search">返回搜索</button></div>`}}
function spark(history=[]){if(history.length<2)return'';if(history.some(x=>!Number.isFinite(x.close)))return '<p class="warning">历史价格存在缺口，暂停绘图。</p>';const vals=history.map(x=>x.close),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;const pts=vals.map((v,i)=>`${(i/(vals.length-1))*100},${100-((v-min)/span)*90}`).join(' ');return `<svg class="spark" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`}
function actionSummaryHtml(stock){if(!stock)return'<div class="action-overview"><p class="muted">请选择股票后查看行动方案</p></div>';if(stock.data?.state!=='ok')return dataStateHtml(stock.data);const p=stock.tradePlan,t=stock.technical||{},score=t.score??null,[tone,label]=badge(score),confidence='规则收益优势尚未验证';return `<section class="action-overview"><div class="action-title"><div><span class="badge ${tone}">${esc(p?.status||label)}</span><b>当前行动方案</b></div><small>验证状态：${confidence}</small></div><p>${t.ma5>t.ma20?'短期价格结构相对改善，但仍需等待成交和关键价格确认。':'短期趋势尚未确认，优先等待而不是追涨。'}</p><div class="action-prices"><span><small>回调关注区</small><b>${p?`${fmt(p.pullbackEntry?.low)}—${fmt(p.pullbackEntry?.high)}`:'暂无'}</b></span><span><small>突破确认</small><b>${p?fmt(p.breakoutPrice)+'以上':'暂无'}</b></span><span class="defense"><small>防守价格</small><b>${p?fmt(p.defensePrice):'暂无'}</b></span><span><small>第一目标参考</small><b>${p?fmt(p.target1):'暂无'}</b></span></div><div class="action-foot"><span>第一目标风险收益比 <b>${p?`1 : ${fmt(p.riskReward1,1)}`:'暂无'}</b></span><button data-go="decisions">查看完整决策 →</button></div></section>`}
function renderStock(){document.body.classList.remove('dashboard-mode','workbench-mode');const s=state.stock,t=s.technical,[c,label]=badge(t.score),trend=t.ma5>t.ma20?'上升':'震荡/走弱',delta=s.signalChange?.scoreDelta;$('#content').innerHTML=`<div class="card hero"><div class="hero-row"><div><p class="eyebrow">${s.exchange} · ${s.symbol}</p><h2>${s.research?.name||s.name}</h2><div class="price">${fmt(s.price)} <small>${s.currency}</small></div><span class="${s.changePct>=0?'up':'down'}">${s.changePct>=0?'+':''}${fmt(s.changePct)}%</span><p class="muted">真实行情 · 可能存在延迟</p></div><div><span class="badge ${c}">${label}</span><div class="score-ring" style="--score:${t.score}%"><b>${t.score??'未判定'}</b></div>${Number.isFinite(delta)?`<p class="score-change ${delta>=0?'up':'down'}">较上次 ${delta>=0?'+':''}${delta} 分${s.signalChange.statusChanged?' · 状态已改变':''}</p>`:'<p class="score-change muted">评分变化记录暂未确认</p>'}</div></div>${spark(s.history)}</div>${actionSummaryHtml(s)}
  <div class="tabs">${[['conclusion','AI 综合结论'],['company','公司研究'],['finance','财务分析'],['industry','行业分析'],['news','新闻与公告'],['events','未来事件'],['risks','风险雷达'],['technical','技术分析'],['trade','买卖决策']].map(x=>`<button class="tab ${state.tab===x[0]?'active':''}" data-tab="${x[0]}">${x[1]}</button>`).join('')}</div><div id="stockModule"></div>${sourceQuality(s.research)}${disclaimer()}`;renderStockModule()}
function sourceQuality(research){return `<div class="card section"><div class="section-head"><h2>数据来源与质量</h2><span class="badge ${research?'green':'yellow'}">${research?'已核验':'部分数据暂不可用'}</span></div><div class="source-grid">${research?.sources?.map(source=>`<div class="source-item"><span class="status-dot ${source.ok?'':'bad'}"></span><div><b>${esc(source.name)}</b><p>${source.ok?'字段完整度 '+source.completeness+'%':'连接失败'}${source.updatedAt?' · 更新 '+String(source.updatedAt).slice(0,10):''}</p></div></div>`).join('')||'<p class="muted">公司、财务或公告数据源暂时没有返回结果；价格行情仍可独立使用。</p>'}</div></div>`}
function renderStockModule(){const s=state.stock,t=s.technical,[c,label]=badge(t.score),r=s.research||{},p=r.company,f=r.finance,anns=r.announcements||[];let html='';
 if(s.data?.state!=='ok'&&['conclusion','technical','trade','risks'].includes(state.tab)){$('#stockModule').innerHTML=dataStateHtml(s.data);return}
 const tone=value=>!Number.isFinite(value)?'yellow':value>=15?'green':value>=0?'blue':value>-15?'orange':'red';
 const financeCard=(title,value,detail,color='blue')=>`<div class="card"><span class="badge ${color}">${f?.reportName||'数据不足'}</span><h2 class="section">${title}</h2><div class="metric small">${value}</div><p class="muted">${detail}</p></div>`;
 if(state.tab==='conclusion')html=`<div class="grid g2"><div class="card"><h2>🧠 当前最重要的三件事</h2><div class="insight"><span class="insight-num">1</span><div><b>经营变化</b><p>${f?`最近报告期营收同比${signed(f.revenueGrowth)}，归母净利润同比${signed(f.profitGrowth)}。`:'财务数据源本次未返回结果，需要稍后重新核验。'}</p></div></div><div class="insight"><span class="insight-num">2</span><div><b>价格风险</b><p>${s.price>t.high20*.97?'当前价格接近最近20日高位，短期追高风险较高。':t.ma5>t.ma20?'最近5日平均价格高于20日平均价格，短期趋势相对改善。':'短期趋势仍偏弱，需要等待价格确认。'}</p></div></div><div class="insight"><span class="insight-num">3</span><div><b>当前策略</b><p>${label}。综合财务、公告和趋势条件判断，不因单日涨跌行动。</p></div></div></div>${periodCards()}</div>`;
 if(state.tab==='company')html=p?`<div class="grid g2"><div class="card"><h2>${esc(p.fullName||r.name)}</h2><p class="note">${esc(p.introduction||'暂无公司简介')}</p><h3 class="section">主要业务范围</h3><p>${esc(p.business||'公开资料暂未返回详细经营范围')}</p></div><div class="card"><h2>公司资料</h2>${[['所属行业',p.industry],['监管行业',p.regulatoryIndustry],['上市交易所',p.exchange],['董事长/负责人',p.chairman],['总经理',p.generalManager],['所在地区',p.location],['公司网站',p.website]].map(([k,v])=>`<div class="factor-row"><span>${k}</span><b>${esc(v||'暂无')}</b></div>`).join('')}</div></div>`:'<div class="card empty">公司资料源暂时不可用，请稍后重试。</div>';
 if(state.tab==='finance')html=f?`<div class="grid g3">${financeCard('营业收入',money(f.revenue),`同比 ${signed(f.revenueGrowth)}`,tone(f.revenueGrowth))}${financeCard('归母净利润',money(f.netProfit),`同比 ${signed(f.profitGrowth)}`,tone(f.profitGrowth))}${financeCard('利润质量',`${fmt(f.grossMargin,1)}% 毛利率`,`净利率 ${fmt(f.netMargin,1)}%`,tone(f.netMargin))}${financeCard('现金流安全',`${fmt(f.operatingCashRevenue,1)}%`,`经营现金流占营业收入`,tone(f.operatingCashRevenue))}${financeCard('负债风险',`${fmt(f.debtRatio,1)}%`,`资产负债率 · 流动比率 ${fmt(f.currentRatio,2)}`,f.debtRatio>70?'red':f.debtRatio>55?'orange':'green')}${financeCard('应收与存货',`${fmt(f.receivableDays,1)}天`,`应收账款周转天数 · 存货周转 ${fmt(f.inventoryDays,1)}天`,'blue')}</div><div class="card section"><div class="section-head"><h2>历史报告趋势</h2><span class="badge blue">${esc(f.reportName)}</span></div><div class="table-wrap"><table class="table"><thead><tr><th>报告期</th><th>营业收入</th><th>营收增长</th><th>归母净利润</th><th>利润增长</th><th>毛利率</th><th>净资产收益率</th></tr></thead><tbody>${f.history.map(row=>`<tr><td>${esc(row.reportName)}</td><td>${money(row.revenue)}</td><td class="${row.revenueGrowth>=0?'up':'down'}">${signed(row.revenueGrowth)}</td><td>${money(row.netProfit)}</td><td class="${row.profitGrowth>=0?'up':'down'}">${signed(row.profitGrowth)}</td><td>${fmt(row.grossMargin,1)}%</td><td>${fmt(row.roe,1)}%</td></tr>`).join('')}</tbody></table></div></div>`:'<div class="card empty"><h2>财务数据本次未返回</h2><p>系统不会使用价格数据代替财务报表，请稍后重新打开。</p></div>';
 if(state.tab==='industry')html=`<div class="grid g2"><div class="card"><h2>行业归属</h2><div class="metric small">${esc(p?.industry||'暂未识别')}</div><p>${esc(p?.regulatoryIndustry||'')}</p><div class="condition">✓ <span>趋势预测已与上证综合指数比较</span></div><div class="condition">${p?.industry?'✓':'○'} <span>公司行业分类来自公开公司资料</span></div><div class="condition">○ <span>行业指数历史对照仍需稳定的板块代码映射</span></div></div><div class="card"><h2>经营与行业线索</h2><p class="note">${esc(p?.introduction||'暂无可核验行业资料')}</p><p>这里不会用固定分数假装行业前景。行业需求、竞争和政策结论需要结合公告、财务变化及可靠行业资料持续更新。</p></div></div>`;
 if(state.tab==='news')html=`<div class="grid g2"><div class="card"><div class="section-head"><h2>公司公告</h2><span class="badge green">可核验</span></div>${anns.length?anns.slice(0,8).map(a=>`<div class="event"><div class="event-icon">告</div><div><b>${esc(a.title)}</b><p class="muted">${esc(a.date)} · ${esc(a.category)}</p><a class="link" href="${a.link}" target="_blank" rel="noopener">查看公告 →</a></div></div>`).join(''):'<div class="empty">公告源暂时无数据</div>'}</div><div class="card"><div class="section-head"><h2>新闻线索</h2><span class="badge blue">需核验</span></div>${s.news?.length?s.news.slice(0,8).map(n=>`<div class="event"><div class="event-icon">闻</div><div><b>${esc(n.title)}</b><p class="muted">${esc(n.publisher||'来源未知')} · ${n.published?new Date(n.published*1000).toLocaleDateString('zh-CN'):''}</p>${n.link?`<a class="link" href="${n.link}" target="_blank" rel="noopener">查看原文 →</a>`:''}</div></div>`).join(''):'<div class="empty">暂无新闻线索</div>'}</div></div>`;
 if(state.tab==='events')html=`<div class="grid g2"><div class="card"><h2>近期重要公告事件</h2>${anns.slice(0,6).map(a=>`<div class="event"><div class="event-icon">◉</div><div><b>${esc(a.category)}</b><p>${esc(a.title)}</p><p class="muted">${esc(a.date)}</p></div></div>`).join('')||'<div class="empty">暂无公告事件</div>'}</div><div class="card"><h2>下一步需要追踪</h2>${['下一份定期财务报告','股东大会及业绩说明会','回购、增减持和重大合同','监管政策与行业需求变化'].map(x=>`<div class="condition">□ <span>${x}</span></div>`).join('')}<p class="note section">只有公告明确日期时才显示确定日期；没有可靠日期的事件不会由 AI 猜测。</p></div></div>`;
 if(state.tab==='risks'){const cashRisk=Number.isFinite(f?.operatingCashRevenue)?clamp(70-f.operatingCashRevenue*3):50,debtRisk=Number.isFinite(f?.debtRatio)?clamp((f.debtRatio-35)*2+35):50,profitRisk=Number.isFinite(f?.profitGrowth)?clamp(50-f.profitGrowth):50;html=`<div class="grid g2"><div class="card"><h2>风险雷达</h2>${[['利润增长风险',profitRisk],['现金流风险',cashRisk],['负债风险',debtRisk],['应收账款风险',Number.isFinite(f?.receivableRevenue)?clamp(f.receivableRevenue*4):50],['近期高位风险',s.price>t.high20*.95?82:45],['短期波动风险',Math.min(90,Math.abs(s.changePct||0)*10+45)]].map(x=>bar(x[0],Math.round(x[1]),x[1]>70?'#d64545':x[1]>55?'#d99a18':'#0f9d68')).join('')}</div><div class="card"><h2>风险依据</h2><p class="note">最近报告期：营收同比 ${signed(f?.revenueGrowth)}，利润同比 ${signed(f?.profitGrowth)}，资产负债率 ${fmt(f?.debtRatio,1)}%，经营现金流占营收 ${fmt(f?.operatingCashRevenue,1)}%。</p><p>行情区间：当前价 ${fmt(s.price)}，最近20日低位 ${fmt(t.low20)}，高位 ${fmt(t.high20)}。</p><p class="warning">财务风险分用于提示需要检查的方向，不代表信用评级或确定损失。</p></div></div>`}
 if(state.tab==='technical')html=`<div class="grid g3"><div class="card"><div class="muted">短期趋势</div><div class="metric small">${t.ma5>t.ma20?'🟢 上升':'🟡 震荡/偏弱'}</div><p>最近5日平均价格 ${fmt(t.ma5)}</p></div><div class="card"><div class="muted">中期趋势</div><div class="metric small">${t.ma20>t.ma60?'🟢 上升':'🟠 偏弱'}</div><p>最近20日平均价格 ${fmt(t.ma20)}</p><p>最近60日平均价格 ${fmt(t.ma60)}</p></div><div class="card"><div class="muted">关键价格区间</div><div class="metric small">${fmt(t.low20)}—${fmt(t.high20)}</div><p>最近20个交易日</p></div></div><div class="card section"><h2>最近90日价格走势</h2>${spark(s.history)}</div>`;
 if(state.tab==='trade')html=`${tradePlanHtml(s.tradePlan)}<div class="grid g3 section"><div class="card"><span class="badge green">📥 入场检查</span><h2 class="section">条件式判断</h2>${conditions(['价格进入回调关注区间','最近5日平均价格高于20日平均价格','突破价格得到确认','营收和利润未明显恶化'],[s.tradePlan?.conditions?.nearPullback,t.ma5>t.ma20,s.tradePlan?.conditions?.breakoutConfirmed,Number.isFinite(f?.profitGrowth)&&f.profitGrowth>=0])}</div><div class="card"><span class="badge yellow">⏳ 当前判断</span><h2 class="section">${esc(s.tradePlan?.status||label)}</h2><p>综合评分 ${t.score}/100。价格区间是动态研究计划，不代表必须买入或卖出。</p><button class="secondary" data-go="prediction">查看趋势概率</button></div><div class="card"><span class="badge red">📤 重新评估</span><h2 class="section">触发条件</h2>${conditions(['跌破动态防守价格','核心投资逻辑失效','利润增长明显转负','价格风险快速上升'],[s.tradePlan?.conditions?.defenseTriggered,false,Number.isFinite(f?.profitGrowth)&&f.profitGrowth<0,s.price>t.high20*.99])}</div></div>`;
 $('#stockModule').innerHTML=html;
}
function bar(name,value,color){return `<div class="bar-row"><div class="bar-label"><span>${name}</span><b>${value}</b></div><div class="bar"><span style="width:${value}%;${color?'background:'+color:''}"></span></div></div>`}
function conditions(names,checks){return names.map((x,i)=>`<div class="condition"><input type="checkbox" ${checks[i]?'checked':''} disabled><span>${x}</span></div>`).join('')}
function tradePlanHtml(plan,personal=false){if(!plan)return'<div class="card empty">交易计划暂时无法计算</div>';if(plan.data?.state!=='ok')return dataStateHtml(plan.data);const outcome=plan.estimatedOutcomeAtDefense,c=plan.conditions||{};return `${dataStateHtml(plan.data)}<div class="card trade-plan"><div class="section-head"><div><h2>${personal?'我的持仓价格计划':'动态买卖价格计划'}</h2><p class="muted">${esc(plan.horizon)} · ${esc(plan.risk)}风险 · ${esc(plan.status)}</p></div><span class="badge blue">每日更新</span></div><div class="trade-price-grid"><div><small>回调关注区间</small><b>${fmt(plan.pullbackEntry?.low)}—${fmt(plan.pullbackEntry?.high)}</b></div><div><small>突破确认价格${c.breakoutConfirmed?' · 已到达':''}</small><b>${fmt(plan.breakoutPrice)}以上</b></div><div class="defense"><small>防守价格${c.defenseTriggered?' · 已触发':''}</small><b>${fmt(plan.defensePrice)}</b></div><div><small>第一止盈参考${c.target1Reached?' · 已到达':''}</small><b>${fmt(plan.target1)}</b></div><div><small>第二止盈参考${c.target2Reached?' · 已到达':''}</small><b>${fmt(plan.target2)}</b></div><div><small>${personal?'防守价预计结果':'第一目标风险收益比'}</small><b class="${Number(outcome)>=0?'up':'down'}">${personal&&Number.isFinite(outcome)?`${outcome>=0?'+':'-'}¥${Math.abs(Math.round(outcome)).toLocaleString()}`:`1 : ${fmt(plan.riskReward1,1)}`}</b></div></div><p class="note section">${esc(plan.basis)}</p><p class="warning">价格到达只代表触发复核：需要再次检查最新行情、公告、财务和原投资逻辑，不执行自动交易。</p></div>`}
function periodCards(){if(state.stock.data?.state!=='ok')return dataStateHtml(state.stock.data);const t=state.stock.technical;return `<div class="grid g3">${[['⚡ 短期',Math.round((t.score+50)/2),'几天—1个月'],['📈 中期',t.score,'1—6个月'],['💎 长期',Math.round((t.score+65)/2),'6个月以上']].map(x=>`<div class="card"><div class="muted">${x[2]}</div><h2>${x[0]}</h2><div class="metric">${x[1]}</div><span class="badge ${badge(x[1])[0]}">${badge(x[1])[1]}</span></div>`).join('')}</div>`}

function dataStateHtml(data){
 if(!data)return '<p class="data-state warning">数据状态未核验</p>';
 const names={ok:'数据正常',insufficient:'数据不足',stale:'数据过期',request_failed:'请求失败'};
 const sessionNames={weekend:'周末休市',holiday:'节假日休市',not_completed:'今日收盘核验时间未到，使用上一完整交易日',completed:'今日收盘核验时间已过'};
 return `<section class="card data-state ${data.state==='ok'?'':'warning'}" role="status"><b>${esc(names[data.state]||'数据未判定')}</b><p>${(data.reasons||[]).map(esc).join('；')}</p><small>数据截止：${esc(data.dataThrough||'未知')} · 获取时间：${esc(data.fetchedAt||'未知')}</small>${sessionNames[data.sessionState]?`<p>${esc(sessionNames[data.sessionState])} · 应有数据截止：${esc(data.expectedThrough||'未知')}</p>`:''}${data.unfinishedBars?'<p>盘中未完成日线已排除。</p>':''}</section>`;
}
function storageStateHtml(storage){return `<p class="storage-state ${storage?.durable?'':'warning'}" role="status">${storage?.durable?'记录已持久保存':esc(storage?.message||'保存状态未确认；当前结果不代表已持久保存')}</p>`}
function probabilityText(value,status){return status==='validated'&&Number.isFinite(value)?fmt(value,1)+'%':'未验证，不显示'}
function originalResearchHtml(item){
 if(!item.original)return item.legacy?'<p>旧版记录：无法证明当时的完整条件，未视为原始快照。</p>':'';
 const o=item.original,l=o.levels||{},latest=item.latest?.snapshot||item;
 return `<details class="original-research"><summary>原始判断与最新观察</summary><p>研究编号：${esc(item.researchId||'未保存')}</p><p>原始截止日期：${esc(o.dataThrough)} · 原入场 ${fmt(l.entry)} · 原失效 ${fmt(l.stop)} · 原目标 T1 ${fmt(l.target1)} / T2 ${fmt(l.target2)}</p><p>最新截止日期：${esc(latest.dataThrough||'未知')} · 最新价格 ${fmt(latest.price)}</p><small>原始快照校验值：${esc(item.snapshotHash||'未保存')}</small>${item.researchId?`<button data-research-history="${esc(item.researchId)}">查看追加记录／写笔记</button>`:''}</details>`;
}
function probabilityTone(value){return value>=60?'green':value>=54?'blue':value<=40?'red':value<=46?'orange':'yellow'}
function signed(value){return `${value>=0?'+':''}${fmt(value,1)}%`}
function scenarioDecisionHtml(){return '<div class="card"><h2>概率行动判断未启用</h2><p>没有通过验证的独立概率依据，不生成情景推荐或模型共振。</p></div>'}
function predictionProbabilityHtml(result){
 return `${dataStateHtml(result.data)}${storageStateHtml(result.storage)}${scenarioDecisionHtml()}<div class="grid g3 section">${(result.horizons||[]).map(item=>`<section class="card"><h2>未来${item.days}个交易日</h2><p>上涨概率：${probabilityText(item.positiveProbability,item.probabilityStatus)}</p><p>跑赢基准概率：${probabilityText(item.outperformProbability,item.probabilityStatus)}</p><p>先止盈后止损概率：未建立</p><p>预训练上涨概率：${probabilityText(item.foundation?.upProbability,item.foundation?.probabilityStatus)}</p><p>${esc(item.committee?.status||item.reason||'验证依据不足')}</p></section>`).join('')}</div><p class="note">${esc(result.methodology)}</p>`;
}
function volumeStructureHtml(result){
 const s=result.volumeStructure;
 if(!s)return`${dataStateHtml(result.data)}${storageStateHtml(result.storage)}<div class="card empty"><h2>无法完成结构判断</h2><p>暂停依赖缺失或过期数据的判断。</p></div>`;
 const checks=[['区间波动已经收窄',s.evidence?.compression],['近期低点没有明显下移',s.evidence?.lowsRising],['当前价格站在20日平均成本上方',s.evidence?.aboveMa20],['成交量已经达到突破标准',s.volume?.ratio>=1.5]];
 const failed=s.tone==='red'||s.stage==='结构失效';
 const confirmed=s.tone==='green'&&(s.stage==='向上突破待确认'||s.stage==='突破后回踩');
 const light=failed?'red':confirmed?'green':'yellow';
 const headline=failed?'现在先避开':confirmed?'开始观察买点':'现在先别买';
 const reason=failed?'走势已经转弱，先等它重新走稳。':confirmed?'上涨信号已经出现，但仍要等收盘和成交量继续确认。':'方向还没确认，等价格和成交量一起给出信号。';
 const valueOk=Number(s.riskReward)>=1.5;
 return `${dataStateHtml(result.data)}${storageStateHtml(result.storage)}<section class="card simple-signal ${light}"><div class="signal-top"><div class="traffic-light ${light}" aria-label="${light==='green'?'绿色，可观察':light==='red'?'红色，先避开':'黄色，继续等待'}"><i></i><i></i><i></i></div><div><p class="eyebrow">${esc(result.name)} · ${esc(result.symbol)} · 数据截至 ${esc(result.dataThrough)}</p><h2>${headline}</h2><p>${reason}</p></div><div class="simple-current"><small>现在价格</small><b>${fmt(result.currentPrice)}</b></div></div></section>
 <div class="simple-rules section"><section class="card simple-rule buy-rule"><span class="rule-icon">✓</span><div><p class="eyebrow">什么时候可以买</p><h2>收盘达到 ${fmt(s.prices?.confirm)} 元以上</h2><p>同时当天成交量要明显增加。两个条件缺一个，都继续等。</p></div></section><section class="card simple-rule stop-rule"><span class="rule-icon">×</span><div><p class="eyebrow">什么时候放弃</p><h2>收盘跌到 ${fmt(s.prices?.invalidation)} 元以下</h2><p>有效收盘价触及原始失效价即结束原结构，不等待放量；实际成交可能偏离条件价。</p></div></section></div>
 <section class="card simple-worth"><h2>风险收益资格：未判定</h2><p>风险收益筛选配置不兼容：第一目标 T1＋1.5 门槛无法通过。正式策略待定，T2 未启用。</p><p>RR1：${fmt(s.riskReward,4)} · RR2：${fmt(s.riskReward2,4)}（仅参考）</p></section>
 <details class="card section structure-details"><summary><span><b>查看详细分析</b><small>量价阶段、区间、成交量和计算依据</small></span><span>展开 ↓</span></summary><div class="details-body"><div class="section-head"><div><p class="eyebrow">专业判断</p><h2>${esc(s.stage)}</h2></div><span class="badge ${esc(s.tone)}">${esc(s.action)}</span></div><p class="structure-summary">${esc(s.summary)}</p><div class="structure-range"><div><small>结构下沿</small><b>${fmt(s.range?.lower)}</b></div><div><small>结构上沿</small><b>${fmt(s.range?.upper)}</b></div><div><small>区间宽度</small><b>${fmt(s.range?.widthPct,1)}%</b></div><div><small>当前量比</small><b>${fmt(s.volume?.ratio,2)}×</b><span>${esc(s.volume?.label)}</span></div></div><div class="grid g2 section"><div class="trigger-box up-trigger"><small>完整买入确认条件</small><b>${esc(s.confirmation)}</b><span>第一目标参考：${fmt(s.prices?.target1)} 元；第二目标参考：${fmt(s.prices?.target2)} 元（未用于筛选）</span></div><div class="trigger-box down-trigger"><small>完整失效条件</small><b>${esc(s.invalidation)}</b><span>风险收益比：${fmt(s.riskReward,2)} : 1</span></div></div><div class="structure-checks">${checks.map(([name,ok])=>`<div class="${ok?'ok':'wait'}"><span>${ok?'✓':'○'}</span><b>${esc(name)}</b></div>`).join('')}</div><div class="volume-meter"><div><span style="width:${Math.min(100,(s.volume?.ratio||0)/1.5*100)}%"></span></div><small>当日成交量为20日均量的 ${fmt(s.volume?.ratio,2)} 倍；突破确认门槛为1.50倍</small></div><p class="footer-note">${esc(s.note)}</p></div></details>`;
}
function predictionResult(result){
 const view=state.predictionView||'structure';
 return `<div class="prediction-tabs" role="tablist"><button class="${view==='structure'?'active':''}" data-prediction-view="structure">量价结构</button><button class="${view==='probability'?'active':''}" data-prediction-view="probability">概率预测</button></div>${view==='structure'?volumeStructureHtml(result):predictionProbabilityHtml(result)}`;
}
function predictionHistoryHtml(){return state.predictionHistory.length?`<div class="card section"><h2>我的最近预测记录</h2><div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>股票</th><th>5日概率</th><th>20日概率</th><th>60日概率</th><th>市场环境</th></tr></thead><tbody>${state.predictionHistory.map(item=>`<tr><td>${new Date(item.createdAt).toLocaleString('zh-CN')}</td><td>${esc(item.name)}<div class="stock-code">${esc(item.symbol)}</div></td>${[5,20,60].map(days=>`<td>${probabilityText(item.result?.horizons?.find(x=>x.days===days)?.outperformProbability,item.result?.horizons?.find(x=>x.days===days)?.probabilityStatus)}</td>`).join('')}<td>${esc(item.result?.market?.regime||'暂无')}</td></tr>`).join('')}</tbody></table></div></div>`:''}
function predictionScorecardHtml(){const card=state.predictionScorecard;if(!card)return'';const o=card.overall||{};return `<section class="card section scorecard"><div class="section-head"><div><h2>AI 历史成绩单</h2><p class="muted">预测完成对应交易周期后自动核验，不提前计算结果</p></div><span class="badge blue">真实后验验证</span></div><div class="scorecard-metrics"><div><small>已完成验证</small><b>${o.evaluated||0}</b></div><div><small>方向命中率</small><b>${Number.isFinite(o.hitRate)?fmt(o.hitRate,1)+'%':'等待样本'}</b></div><div><small>平均实际收益</small><b class="${(o.averageReturn||0)>=0?'up':'down'}">${Number.isFinite(o.averageReturn)?signed(o.averageReturn):'等待样本'}</b></div><div><small>跑赢上证比例</small><b>${Number.isFinite(o.outperformRate)?fmt(o.outperformRate,1)+'%':'等待样本'}</b></div></div><div class="table-wrap"><table class="table"><thead><tr><th>预测周期</th><th>已验证</th><th>等待验证</th><th>方向命中率</th><th>平均实际收益</th><th>跑赢市场比例</th></tr></thead><tbody>${(card.horizons||[]).map(x=>`<tr><td>未来${x.days}个交易日</td><td>${x.evaluated}</td><td>${x.pending}</td><td>${Number.isFinite(x.hitRate)?fmt(x.hitRate,1)+'%':'—'}</td><td class="${(x.averageReturn||0)>=0?'up':'down'}">${Number.isFinite(x.averageReturn)?signed(x.averageReturn):'—'}</td><td>${Number.isFinite(x.outperformRate)?fmt(x.outperformRate,1)+'%':'—'}</td></tr>`).join('')}</tbody></table></div><p class="footer-note">同一股票同一数据日期只统计一次；实际收益扣除0.2%模拟摩擦成本。样本少时不能据此判断模型稳定性。</p></section>`}
async function predictionPage(){document.body.classList.remove('dashboard-mode');const result=state.prediction;const [history,scorecard]=await Promise.allSettled([api('/api/predictions/recent'),api('/api/predictions/scorecard')]);if(history.status==='fulfilled')state.predictionHistory=history.value.predictions||[];else state.predictionHistory=[];if(scorecard.status==='fulfilled')state.predictionScorecard=scorecard.value;else state.predictionScorecard=null;$('#content').innerHTML=`<div class="card"><div class="section-head"><div><h2>⌁ 趋势预测中心</h2><p class="muted">先看量价结构是否确认，再把模型概率作为辅助证据</p></div><span class="badge blue">结构优先 · 概率第二</span></div><form id="predictionForm" class="prediction-form"><label>股票代码<input id="predictionSymbol" class="input" name="symbol" required maxlength="12" value="${esc(result?.code||'601138')}" placeholder="例如 601138"></label><button class="primary" type="submit">分析量价结构</button></form><p class="footer-note">输入六位沪深 A 股代码。系统使用已完成日线与真实成交量判断阶段，不连接证券账户，也不能下单。</p></div><div id="predictionResult" class="section">${result?predictionResult(result):'<div class="card empty"><h2>先输入一只股票</h2><p>系统会先识别回调、横盘、突破、回踩或失效，再展示5、20、60日概率作为辅助。</p></div>'}</div>${history.status==='rejected'?`<p class="warning">记录暂不可读取：${esc(history.reason.message)}</p>`:''}${state.predictionView==='probability'?predictionScorecardHtml()+predictionHistoryHtml():''}${disclaimer()}`}

function volumeScreenResults(result){
 const items=result?.items||[],c=result?.coverage||{},unknown=c.usable===0||!Number.isFinite(c.usable);
 const empty=unknown?'无法完成判断':c.partial?'已完成核验范围内未发现符合条件的观察候选，其余范围未知':'本次核验范围内未发现符合结构观察条件的候选';
 return `${storageStateHtml(result.storage)}${result.legacy?'<p class="warning">旧版扫描记录；旧目标及资格不代表当前规则。</p>':''}<section class="card data-state"><h2>合格候选：未判定</h2><p>风险收益筛选配置不兼容；T1＋1.5，正式策略待定，T2 未启用。</p><p>请求 ${c.requested??c.checked??0}，成功返回 ${c.returned??'未知'}，失败 ${c.failed??'未知'}，可判断 ${c.usable??'未知'}；判断覆盖率 ${fmt(c.coveragePct,1)}%</p><p>结构观察 ${unknown?'未判定':(result.counts?.observations??items.length)+' 只'}，本次取得 ${items.length} 条观察记录。</p><p>数据截止范围：${esc(c.dateRange?.join(' 至 ')||'未知')} · 获取：${esc(result.createdAt||'未知')}</p>${c.marketPages?`<p>行情分页单独统计：请求 ${c.marketPages.requested}，成功 ${c.marketPages.returned}，失败 ${c.marketPages.failed}</p>`:''}${result.historyRead?.state==='unavailable'?`<p class="warning">记录暂不可读取：${esc(result.historyRead.reason)}</p>`:''}<details><summary>查看数据失败原因</summary>${(c.failures||[]).map(f=>`<p>${esc(f.symbol)} · ${esc(f.code)} · ${esc(f.message)}</p>`).join('')||'<p>没有股票请求失败记录。</p>'}</details></section><div class="volume-screen-list">${items.map(item=>`<article class="volume-screen-card ${esc(item.tone)}"><div class="volume-screen-head"><div><span class="screen-status">${esc(item.status)}</span><h2>${esc(item.name)} <small>${esc(item.code)}</small></h2></div><b class="screen-price">${fmt(item.price)}</b></div><p>${esc(item.reason)}</p><div class="screen-levels"><div><small>突破参考</small><b>${fmt(item.confirmPrice)}</b></div><div><small>原始失效价（如已留档）</small><b>${fmt(item.giveUpPrice)}</b></div><div><small>最新结构目标 T1 / T2</small><b>${fmt(item.targetPrice)} / ${fmt(item.target2)}</b></div></div><p>RR1 ${fmt(item.riskReward,4)} · RR2 ${fmt(item.riskReward2,4)}（T2未启用）</p><p>阻力参考：${fmt(item.resistanceReference)} · 数据截止 ${esc(item.dataThrough)}</p>${originalResearchHtml(item)}<button data-stock="${esc(item.symbol)}" data-name="${esc(item.name)}">查看这只股票</button><button data-add="${esc(item.symbol)}" data-code="${esc(item.code)}" data-name="${esc(item.name)}">加入股票池</button></article>`).join('')||`<div class="card empty"><h2>${empty}</h2><p>合格候选资格未判定。</p></div>`}</div>${(result.retained||[]).length?`<section class="card"><h2>历史跟踪：本次数据未核验</h2>${result.retained.map(t=>`<h3>${esc(t.name||t.symbol)}</h3>${originalResearchHtml(t)}`).join('')}</section>`:''}`;
}

function volumeScreenProgress(progress={}){
 const checked=progress.checked||0,total=Math.max(progress.total||1200,1),percent=Math.min(100,Math.round(checked/total*100));
 return `<div class="card volume-screen-progress"><h2>正在分批检查股票</h2><p>已经检查 ${checked} / ${total} 只，找到 ${progress.found||0} 只候选。</p><div class="bar"><span style="width:${percent}%"></span></div><small>${percent}% · 可以停留在本页等待</small></div>`;
}

async function pollVolumeScreen(jobId,owner){
 state.volumeScreenPolling=jobId;
 for(let tries=0;tries<800;tries++){
   await new Promise(resolve=>setTimeout(resolve,1500));
   if(currentUser!==owner||state.page!=='volumeScreen'||state.volumeScreenPolling!==jobId)return;
   const job=await api('/api/volume-screen/jobs/'+encodeURIComponent(jobId));
   if(currentUser!==owner||state.page!=='volumeScreen'||state.volumeScreenPolling!==jobId)return;
   if(job.status==='running'){const box=$('#volumeScreenResult');if(box)box.innerHTML=volumeScreenProgress(job.progress);continue}
   if(job.status==='done'){state.volumeScreen=job.result;state.volumeScreenPolling=null;await volumeScreenPage();return}
   if(job.status==='failed'){state.volumeScreenPolling=null;throw new Error(job.error||'筛选失败')}
 }
 state.volumeScreenPolling=null;throw new Error('筛选时间较长，请稍后再打开本页查看');
}

async function volumeScreenPage(){
 const owner=currentUser,epoch=state.volumeReadEpoch=(state.volumeReadEpoch||0)+1;
 document.body.classList.remove('dashboard-mode');
 let readError='';
 if(!state.volumeScreen&&!state.volumeScreenPolling){try{const response=await api('/api/volume-screen/latest');if(currentUser!==owner||state.page!=='volumeScreen'||state.volumeReadEpoch!==epoch)return;state.volumeScreen=response.result}catch(error){if(currentUser!==owner||state.page!=='volumeScreen'||state.volumeReadEpoch!==epoch)return;readError=error.message}}
 if(currentUser!==owner||state.page!=='volumeScreen'||state.volumeReadEpoch!==epoch)return;
 $('#content').innerHTML=`<section class="card volume-screen-intro"><div><p class="eyebrow">自动找股票</p><h2>找出正在“缩量等待”的股票</h2><p>先回调，再横盘，成交量变小，低点不再往下。真正放量上涨时才确认。</p></div><form id="volumeScreenForm"><button class="primary" type="submit">${state.volumeScreenPolling?'正在筛选…':'开始筛选'}</button></form></section><div id="volumeScreenResult" class="section">${readError?`<p class="warning">记录暂不可读取：${esc(readError)}</p>`:''}${state.volumeScreen?volumeScreenResults(state.volumeScreen):state.volumeScreenPolling?volumeScreenProgress():'<div class="card empty"><h2>点一下开始筛选</h2><p>系统会分批检查约1200只成交活跃A股，并固定跟踪入选股票。</p></div>'}</div>${disclaimer()}`;
}

async function decisions(){ $('#content').innerHTML=loading();const rows=await quoteMany(state.watch);$('#content').innerHTML=`<div class="card"><div class="section-head"><div><h2>🎯 股票池动态价格计划</h2><p class="muted">每天按真实行情更新；回调买入与突破买入是两种不同路径</p></div><span class="badge blue">研究辅助</span></div><div class="table-wrap"><table class="table"><thead><tr><th>股票</th><th>现价</th><th>回调关注区间</th><th>突破确认价</th><th>防守价</th><th>第一止盈</th><th>第二止盈</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map(x=>{const p=x.tradePlan;return `<tr><td><b>${esc(x.name)}</b><div class="stock-code">${esc(x.symbol)}</div></td><td>${fmt(x.price)}</td><td>${p?fmt(p.pullbackEntry.low)+'—'+fmt(p.pullbackEntry.high):'暂无'}</td><td>${p?fmt(p.breakoutPrice):'暂无'}</td><td class="down">${p?fmt(p.defensePrice):'暂无'}</td><td>${p?fmt(p.target1):'暂无'}</td><td>${p?fmt(p.target2):'暂无'}</td><td><span class="badge ${p?.conditions?.defenseTriggered?'red':p?.conditions?.nearPullback?'green':'yellow'}">${esc(p?.status||'待计算')}</span></td><td><button class="link" data-stock="${x.symbol}" data-name="${esc(x.name)}">详情</button></td></tr>`}).join('')}</tbody></table></div><p class="note section">股票池没有个人成本，因此这里是通用行情计划；持仓成本仅用于盈亏计算，不改变公共结构目标；回调计划需要明确的入场参数。</p></div>${disclaimer()}` }
async function risks(){
 $('#content').innerHTML=loading();const owner=currentUser;
 const rows=await Promise.all(state.watch.slice(0,20).map(async item=>{
  const [m,r]=await Promise.allSettled([quote(item.symbol),api('/api/research/'+encodeURIComponent(item.symbol))]);const q=m.status==='fulfilled'?m.value:null,f=r.status==='fulfilled'?r.value.finance:null,flags=[];
  if(Number.isFinite(q?.technical?.score)&&q.technical.score<50)flags.push('技术条件评分低于50，需复核走势');
  if(Number.isFinite(f?.profitGrowth)&&f.profitGrowth<0)flags.push('已披露净利润同比下降');
  if(Number.isFinite(f?.operatingCashRevenue)&&f.operatingCashRevenue<0)flags.push('经营现金流与收入比为负，需核验回款');
  if(Number.isFinite(f?.debtRatio)&&f.debtRatio>70)flags.push('资产负债率高于70%，需结合行业判断');
  return {item,q,f,flags,missing:!q||!f};
 }));if(currentUser!==owner||state.page!=='risks')return;
 $('#content').innerHTML=`<div class="card"><h2>风险复核清单</h2><p>检查股票池前20只（共${state.watch.length}只）。阈值是研究提醒，不是亏损概率。</p>${rows.map(({item,q,f,flags,missing})=>`<div class="event"><div><h3>${esc(q?.name||item.name)} · ${flags.length?'需复核'+flags.length+'项':missing?'资料不完整':'未触发本页规则'}</h3>${flags.map(s=>`<p>⚠ ${esc(s)}</p>`).join('')}${missing?'<p>数据缺失，不能据此判断安全。</p>':''}<p>利润同比 ${signed(f?.profitGrowth)}；负债率 ${fmt(f?.debtRatio)}%；报告期 ${esc(f?.reportDate||'未知')}</p><button data-stock="${esc(item.symbol)}">查看研究</button></div></div>`).join('')||'股票池为空'}</div>${disclaimer()}`;
}
async function recentEvents(){ $('#content').innerHTML=loading();const researched=await Promise.all(state.watch.slice(0,8).map(async item=>{try{return await api('/api/research/'+encodeURIComponent(item.symbol))}catch{return null}}));const items=researched.filter(Boolean).flatMap(stock=>(stock.announcements||[]).slice(0,3).map(a=>({...a,name:stock.name,symbol:stock.symbol}))).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,20);$('#content').innerHTML=`<div class="grid g2"><div class="card"><div class="section-head"><h2>股票池最新公告</h2><span class="badge green">自动汇总</span></div>${items.map(a=>`<div class="event"><div class="event-icon">告</div><div><b>${esc(a.name)} · ${esc(a.category)}</b><p>${esc(a.title)}</p><p class="muted">${esc(a.date)}</p><a class="link" href="${a.link}" target="_blank" rel="noopener">查看公告 →</a></div></div>`).join('')||'<div class="empty">股票池暂无可核验公告</div>'}</div><div class="card"><h2>持续追踪清单</h2>${['财务报告与业绩说明会','股东大会和管理层变化','股份回购与股东增减持','重大合同、投资和融资','监管处罚与风险提示'].map(x=>`<div class="condition">□ <span>${x}</span></div>`).join('')}<p class="note section">登录网站时系统会检查股票池行情风险；公告事件会在本页集中显示。</p></div></div>${disclaimer()}` }
async function events(){
 const owner=currentUser;await recentEvents();let items=[];try{items=(await api('/api/radar/journal')).items}catch{}
 if(currentUser!==owner||state.page!=='events')return;
 const calendar=items.flatMap(j=>(j.idea.evidence||[]).flatMap(e=>(e.eventDates||[]).map(d=>({...d,name:j.idea.name,title:e.title,link:e.link})))).sort((a,b)=>a.date.localeCompare(b.date));
 $('#content').insertAdjacentHTML('afterbegin',`<div class="card section"><h2>Allen 事件时间线</h2><p>来自已跟踪研究卡的原文计划日期；不是完整市场日历，不保证按期发生。</p>${calendar.map(d=>`<div class="event"><div><h3>${esc(d.date)} · ${esc(d.name)}</h3><p>${esc(d.title)}</p><blockquote>${esc(d.passage)}</blockquote><a href="${esc(d.link)}" target="_blank" rel="noopener">核验原公告</a></div></div>`).join('')||'<p>尚无含完整计划日期的研究卡。时间未知的事件不会自动编排日期。</p>'}<button data-go="aiScreen">发现并跟踪事件 →</button></div>`);
}
async function portfolio(){const rows=await Promise.all(state.portfolio.map(async p=>{try{const params=new URLSearchParams({cost:p.buy,qty:p.qty,horizon:p.cycle||'中期',risk:p.riskPreference||'中'});const [market,plan]=await Promise.all([quote(p.symbol),api('/api/trade-plan/'+encodeURIComponent(p.symbol)+'?'+params)]);return {...p,...market,personalPlan:plan}}catch{return p}}));const value=rows.reduce((a,x)=>a+(x.price||x.buy)*x.qty,0),cost=rows.reduce((a,x)=>a+x.buy*x.qty,0);$('#content').innerHTML=`<div class="grid g3"><div class="card"><div class="muted">持仓股票</div><div class="metric">${rows.length}</div></div><div class="card"><div class="muted">当前市值</div><div class="metric">¥${Math.round(value).toLocaleString()}</div></div><div class="card"><div class="muted">浮动收益</div><div class="metric ${value>=cost?'up':'down'}">${cost?fmt((value/cost-1)*100):'0.00'}%</div></div></div><section class="section"><div class="section-head"><h2>持仓与价格计划</h2><button class="primary" data-modal="portfolio">＋ 添加持仓</button></div><div class="grid g2">${rows.map((x,i)=>`<div><div class="card holding-head"><div class="section-head"><div><h2>${esc(x.name)}</h2><span class="stock-code">${esc(x.symbol)} · ${esc(x.cycle||'中期')} · ${esc(x.riskPreference||'中')}风险</span></div><button class="link" data-del-portfolio="${i}">删除</button></div><div class="holding-stats"><span>成本 <b>${fmt(x.buy)}</b></span><span>现价 <b>${fmt(x.price)}</b></span><span>数量 <b>${x.qty}</b></span><span>收益 <b class="${(x.price||x.buy)>=x.buy?'up':'down'}">${fmt(((x.price||x.buy)/x.buy-1)*100)}%</b></span></div></div>${costView({...x,tradePlan:x.personalPlan})}${tradePlanHtml(x.personalPlan,true)}</div>`).join('')||'<div class="card empty">还没有持仓</div>'}</div></section>${disclaimer()}`}

const yuan=value=>Number.isFinite(value)?'¥'+Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):'暂无';
function tradeFees(amount,fees,isSell=false){const commission=Math.max(fees.minimumCommission,amount*fees.commissionRatePer10000/10000),transfer=amount*fees.transferFeeRatePer10000/10000,stamp=isSell?amount*fees.stampDutyRatePer10000/10000:0;return {commission,transfer,stamp,total:commission+transfer+stamp}}
function sellNet(price,qty,fees){const amount=price*qty;return amount-tradeFees(amount,fees,true).total}
function priceForNet(targetNet,qty,fees,start){let low=0,high=Math.max(start||1,targetNet/qty*1.2);while(sellNet(high,qty,fees)<targetNet&&high<1e7)high*=2;for(let i=0;i<70;i++){const mid=(low+high)/2;if(sellNet(mid,qty,fees)>=targetNet)high=mid;else low=mid}return high}
function calculateTrade(input,fees){const buyAmount=input.buyPrice*input.qty,buyFee=tradeFees(buyAmount,fees),totalCost=buyAmount+buyFee.total,sellAmount=input.sellPrice*input.qty,sellFee=tradeFees(sellAmount,fees,true),netProceeds=sellAmount-sellFee.total,profit=netProceeds-totalCost,returnPct=totalCost?profit/totalCost*100:0,breakEven=priceForNet(totalCost,input.qty,fees,input.buyPrice);let maxShares=null;if(input.capital>0){maxShares=Math.floor(input.capital/input.buyPrice/100)*100;while(maxShares>0){const amount=maxShares*input.buyPrice;if(amount+tradeFees(amount,fees).total<=input.capital)break;maxShares-=100}}return {...input,buyAmount,buyFee,totalCost,sellAmount,sellFee,netProceeds,profit,returnPct,breakEven,maxShares,stopProfit:input.stopPrice>0?sellNet(input.stopPrice,input.qty,fees)-totalCost:null,targetPrice:input.targetProfit>0?priceForNet(totalCost+input.targetProfit,input.qty,fees,input.sellPrice):null}}
function calculatorResultHtml(r){if(!r)return '<div class="card empty"><h2>输入计划后开始计算</h2><p>结果会把双向佣金、卖出印花税和双向过户费计算在内。</p></div>';return `<div class="grid g4"><div class="card"><div class="muted">买入总成本</div><div class="metric small">${yuan(r.totalCost)}</div><p class="muted">买入金额 ${yuan(r.buyAmount)}<br>买入费用 ${yuan(r.buyFee.total)}</p></div><div class="card"><div class="muted">卖出后到账</div><div class="metric small">${yuan(r.netProceeds)}</div><p class="muted">卖出金额 ${yuan(r.sellAmount)}<br>卖出费用 ${yuan(r.sellFee.total)}</p></div><div class="card"><div class="muted">预计净盈亏</div><div class="metric small ${r.profit>=0?'up':'down'}">${r.profit>=0?'+':''}${yuan(r.profit)}</div><p class="muted">含全部估算交易费用</p></div><div class="card"><div class="muted">预计净收益率</div><div class="metric small ${r.returnPct>=0?'up':'down'}">${r.returnPct>=0?'+':''}${fmt(r.returnPct)}%</div><p class="muted">以买入总成本计算</p></div></div><div class="grid g2 section"><div class="card"><h2>关键价格与资金</h2><div class="factor-row"><span>含费用保本卖价</span><b>${yuan(r.breakEven)} / 股</b></div><div class="factor-row"><span>参考资金最多可买</span><b>${r.capital>0?(r.maxShares||0).toLocaleString()+' 股':'未填写资金'}</b></div><div class="factor-row"><span>目标净利润对应卖价</span><b>${r.targetPrice?yuan(r.targetPrice)+' / 股':'未填写目标净利润'}</b></div><div class="factor-row"><span>止损价对应净盈亏</span><b class="${(r.stopProfit??0)>=0?'up':'down'}">${Number.isFinite(r.stopProfit)?yuan(r.stopProfit):'未填写止损价'}</b></div></div><div class="card"><h2>费用明细</h2>${[['买入佣金',r.buyFee.commission],['买入过户费',r.buyFee.transfer],['卖出佣金',r.sellFee.commission],['卖出印花税',r.sellFee.stamp],['卖出过户费',r.sellFee.transfer]].map(([name,value])=>`<div class="factor-row"><span>${name}</span><b>${yuan(value)}</b></div>`).join('')}</div></div>`}
function calculator(){const f=state.feeSettings||defaultFees,r=state.calculatorResult;$('#content').innerHTML=`<div class="section-head"><div><h2>¥ 股票利润亏损计算器</h2><p class="muted">适用于国信金太阳中可交易的沪深 A 股 · 结果为费用估算</p></div><span class="badge blue">个人费率</span></div><form id="calculatorForm" class="card calculator-form"><div class="calculator-grid"><label>股票名称（可选）<input class="input" name="name" value="${esc(r?.name||'')}" placeholder="例如 工业富联"></label><label>买入价格（元）<input class="input" name="buyPrice" type="number" min="0.001" step="0.001" required value="${esc(r?.buyPrice||'')}"></label><label>股票数量（股）<input class="input" name="qty" type="number" min="1" step="1" required value="${esc(r?.qty||100)}"></label><label>计划卖出价格（元）<input class="input" name="sellPrice" type="number" min="0.001" step="0.001" required value="${esc(r?.sellPrice||'')}"></label><label>止损价格（可选）<input class="input" name="stopPrice" type="number" min="0" step="0.001" value="${esc(r?.stopPrice||'')}"></label><label>参考资金（可选）<input class="input" name="capital" type="number" min="0" step="100" value="${esc(r?.capital||'')}"></label><label>目标净利润（可选）<input class="input" name="targetProfit" type="number" min="0" step="100" value="${esc(r?.targetProfit||'')}"></label></div><details class="fee-settings" open><summary>个人交易费率设置</summary><div class="calculator-grid section"><label>佣金（每万元）<input class="input" name="commissionRatePer10000" type="number" min="0" max="30" step="0.01" value="${f.commissionRatePer10000}"></label><label>单笔最低佣金（元）<input class="input" name="minimumCommission" type="number" min="0" max="100" step="0.01" value="${f.minimumCommission}"></label><label>卖出印花税（每万元）<input class="input" name="stampDutyRatePer10000" type="number" min="0" max="20" step="0.01" value="${f.stampDutyRatePer10000}"></label><label>过户费（每万元，双向）<input class="input" name="transferFeeRatePer10000" type="number" min="0" max="5" step="0.01" value="${f.transferFeeRatePer10000}"></label></div><p class="footer-note">默认佣金仅是示例。请在国信金太阳的交割单或联系客户经理确认你的实际佣金，若券商存在其他规费或优惠也请相应调整。</p></details><button class="primary" type="submit">计算净利润与关键价格</button></form><div id="calculatorResult" class="section">${calculatorResultHtml(r)}</div><p class="note section">A 股买入通常按 100 股整数倍申报；“最多可买”按整手估算。实际成交价、费用减免、分次成交和券商取整方式可能让最终结果有小额差异。</p>${disclaimer()}`}
async function theses(){
 const owner=currentUser;$('#content').innerHTML=loading();const journal=await researchJournalHtml();if(currentUser!==owner||state.page!=='theses')return;
 $('#content').innerHTML=`<div class="section-head"><div><h2>我的投资逻辑 · Allen研究卡</h2><p class="muted">先留下判断，再记录证据变化。</p></div><button class="primary" data-modal="thesis">＋ 手动记录逻辑</button></div>${allenScorecard(state.researchJournal||[])}${journal}<div class="grid g2 section">${state.theses.map((x,i)=>`<div class="card"><h2>${esc(x.name)}</h2><p>${esc(x.symbol)} · ${esc(x.cycle)}</p><h3>原始理由</h3><p>${esc(x.reason)}</p><h3>失效条件</h3><p>${esc(x.risk)}</p><button class="danger" data-del-thesis="${i}">删除手动记录</button></div>`).join('')}</div>${disclaimer()}`;
}
async function brief(){
 const owner=currentUser;$('#content').innerHTML=loading();const rows=await quoteMany(state.watch);let items=[];try{items=(await api('/api/radar/journal')).items}catch{}
 if(currentUser!==owner||state.page!=='brief')return;
 const up=rows.filter(x=>Number.isFinite(x.changePct)&&x.changePct>0).length,down=rows.filter(x=>Number.isFinite(x.changePct)&&x.changePct<0).length,unknown=rows.filter(x=>!Number.isFinite(x.changePct)).length;
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),due=items.filter(j=>j.status==='跟踪中'&&j.window.end<=today);
 $('#content').innerHTML=`<div class="card hero"><h2>Allen 今日研究简报</h2><p>上涨${up}只 · 下跌${down}只 · 数据缺失${unknown}只。其余为平盘。</p><small>规则汇总，不是另一次AI生成报告。</small></div><div class="grid g2 section"><div class="card"><h2>今天先验证什么</h2>${due.map(j=>`<p>${esc(j.idea.name)}：研究窗口已到期，核对事件与价格表现。</p>`).join('')||'<p>没有已到期且仍在跟踪的研究卡。</p>'}${items.filter(j=>j.status==='需要复核'||j.status==='逻辑失效').map(j=>`<p>⚠ ${esc(j.idea.name)}：${esc(j.status)}</p>`).join('')}<button data-go="theses">进入研究卡复核</button></div><div class="card"><h2>我的研究进度</h2><p>已跟踪${items.length}条逻辑；完成复盘${items.filter(j=>j.status==='完成复盘').length}条。</p><p>复盘完成不等于预测正确。先检查证据兑现，再看价格结果。</p><button data-go="events">查看事件时间线</button></div></div>${disclaimer()}`;
}
async function settings(){
 const owner=currentUser;let health={},journal={};try{[health,journal]=await Promise.all([api('/api/health'),api('/api/radar/journal')])}catch{}
 if(currentUser!==owner||state.page!=='settings')return;
 $('#content').innerHTML=`<div class="grid g2"><div class="card"><h2>${esc(currentUser?.displayName||'Allen')}</h2><p>版本${esc(health.version||'未知')}</p><button id="settingsLogout" class="danger">退出登录</button></div><div class="card"><h2>能力状态</h2><p>AI：${health.aiConfigured?'已配置（不代表本次调用成功）':'未配置'}</p><p>研究档案：${journal.durable?'数据库保存':'仅内存或状态未知'}</p><p>已实现：公告列表、正文读取、历史涨幅检查、研究卡与原始报告保存。</p><p>未实现：完整市场未来日历、机构一致预期、全市场连续扫描、严格样本外收益回测。</p><p>数据源可能缺失或限流，覆盖量与正文状态请看具体报告。未接入国信证券账户。</p></div></div>`;
}
const dateTime=value=>value?new Date(value).toLocaleString('zh-CN'):'从未';
async function adminPage(){try{const [{users},{announcements}]=await Promise.all([api('/api/admin/users'),api('/api/admin/announcements')]);$('#content').innerHTML=`<div class="section-head"><div><h2>用户管理</h2><p class="muted">仅管理员可见 · 在线表示最近2分钟内有活动</p></div><div class="toolbar"><button class="ghost" data-backup>导出安全备份</button><button class="primary" data-modal="user">＋ 创建用户</button></div></div><div class="card"><div class="table-wrap"><table class="table"><thead><tr><th>用户</th><th>角色</th><th>在线状态</th><th>最近登录</th><th>设备</th><th>账号</th><th>操作</th></tr></thead><tbody>${users.map(u=>`<tr><td><b>${esc(u.displayName)}</b><div class="stock-code">${esc(u.username)}</div></td><td>${u.role==='admin'?'管理员':'普通用户'}</td><td><span class="presence ${u.online?'online':''}"></span>${u.online?'在线':'离线'}<div class="stock-code">活动：${dateTime(u.lastSeenAt)}</div></td><td>${dateTime(u.lastLoginAt)}</td><td>${u.deviceCount||0} 台</td><td><span class="badge ${u.active?'green':'red'}">${u.active?'正常':'已停用'}</span></td><td>${String(u.id)===String(currentUser?.id)?'<span class="muted">当前管理员</span>':`<button class="link" data-user-force="${u.id}">强制下线</button> · <button class="link" data-user-toggle="${u.id}">${u.active?'停用':'启用'}</button> · <button class="link" data-user-reset="${u.id}">重置密码</button>`}</td></tr>`).join('')}</tbody></table></div></div><section class="section"><div class="section-head"><div><h2>站内通知</h2><p class="muted">用户进入网站时弹出未读通知</p></div><button class="primary" data-modal="announcement">＋ 发布通知</button></div><div class="grid g2">${announcements.map(a=>`<div class="card"><div class="section-head"><span class="badge ${a.level==='重要'?'red':a.level==='更新'?'blue':'yellow'}">${esc(a.level)}</span><span class="muted">${new Date(a.createdAt).toLocaleDateString('zh-CN')}</span></div><h2>${esc(a.title)}</h2><p>${esc(a.content)}</p><p class="muted">${a.readCount||0} 人已读 · ${a.active?'正在显示':'已停止显示'}</p><button class="${a.active?'danger':'secondary'}" data-announcement-toggle="${a.id}">${a.active?'停止通知':'重新启用'}</button></div>`).join('')||'<div class="card empty">还没有通知</div>'}</div></section>`}catch(e){$('#content').innerHTML=`<div class="card empty">${esc(e.message)}</div>`}}
function disclaimer(){return '<p class="footer-note">数据可能延迟，仅用于研究辅助，不构成投资建议。系统不会保证涨跌或收益；缺少来源的数据会明确标记，而不会由 AI 编造。</p>'}
function modal(type){const thesis=type==='thesis';document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><form id="modalForm" class="modal-card"><div class="section-head"><h2>${thesis?'新建投资逻辑':'添加持仓'}</h2><button type="button" class="ghost" data-close>关闭</button></div><div class="form-grid"><label>股票名称<input class="input" name="name" required placeholder="工业富联"></label><label>股票代码<input class="input" name="symbol" required placeholder="601138 或 601138.SS"></label>${thesis?`<label>投资周期<select class="input" name="cycle"><option>短期</option><option>中期</option><option>中长期</option><option>长期</option></select></label><label class="full">为什么买？<textarea name="reason" required></textarea></label><label class="full">逻辑失效条件<textarea name="risk" required></textarea></label>`:`<label>买入价格<input class="input" name="buy" type="number" step="0.01" required></label><label>数量<input class="input" name="qty" type="number" min="1" required></label><label>投资周期<select class="input" name="cycle"><option>短期</option><option selected>中期</option><option>长期</option></select></label><label>风险偏好<select class="input" name="riskPreference"><option>低</option><option selected>中</option><option>高</option></select></label><label>买入日期<input class="input" name="date" type="date" required></label><label class="full">买入逻辑<textarea name="thesis"></textarea></label>`}</div><button class="primary wide">保存</button><input type="hidden" name="type" value="${type}"></form></div>`)}
function userModal(){document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><form id="userForm" class="modal-card"><div class="section-head"><h2>创建普通用户</h2><button type="button" class="ghost" data-close>关闭</button></div><div class="form-grid"><label>用户名<input class="input" name="username" required minlength="3" placeholder="至少3位，例如 test01"></label><label>显示名称<input class="input" name="displayName" required placeholder="例如 张三"></label><label class="full">初始密码<input class="input" name="password" type="password" required minlength="6" placeholder="至少6位"></label></div><button class="primary wide" type="submit">创建账号</button></form></div>`)}
function announcementAdminModal(){document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="modal"><form id="announcementForm" class="modal-card"><div class="section-head"><h2>发布站内通知</h2><button type="button" class="ghost" data-close>关闭</button></div><div class="form-grid"><label>通知类型<select class="input" name="level"><option>通知</option><option selected>更新</option><option>重要</option></select></label><label class="full">标题<input class="input" name="title" required maxlength="120" placeholder="例如：智能选股功能已更新"></label><label class="full">通知内容<textarea name="content" required maxlength="2000" placeholder="写清楚这次更新或需要用户注意的事情"></textarea></label></div><button class="primary wide" type="submit">立即发布</button></form></div>`)}
function showAnnouncementQueue(items){if(!items?.length||$('#announcementPopup'))return;const a=items[0];document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="announcementPopup"><div class="modal-card announcement-card"><div class="announcement-icon">🔔</div><span class="badge ${a.level==='重要'?'red':a.level==='更新'?'blue':'yellow'}">${esc(a.level)}</span><h2>${esc(a.title)}</h2><p>${esc(a.content)}</p><p class="muted">${new Date(a.createdAt).toLocaleDateString('zh-CN')}</p><div class="announcement-actions"><button class="ghost" data-announcement-later>稍后提醒</button><button class="primary" data-announcement-read="${a.id}">我知道了</button></div></div></div>`);$('#announcementPopup').dataset.remaining=JSON.stringify(items.slice(1))}
async function showUnreadAnnouncements(){try{const {announcements}=await api('/api/announcements');showAnnouncementQueue(announcements)}catch{}}
function showAlertQueue(items){if(!items?.length)return;if($('#announcementPopup')||$('#alertPopup')){setTimeout(()=>showAlertQueue(items),1200);return}const a=items[0];document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="alertPopup"><div class="modal-card announcement-card"><div class="announcement-icon">${a.level==='风险'?'🚨':'🔔'}</div><span class="badge ${a.level==='风险'?'red':'orange'}">${esc(a.level)}</span><h2>${esc(a.title)}</h2><p>${esc(a.content)}</p><p class="muted">${new Date(a.createdAt).toLocaleString('zh-CN')}</p><div class="announcement-actions"><button class="ghost" data-alert-later>稍后提醒</button><button class="primary" data-alert-read="${a.id}">我知道了</button></div></div></div>`);$('#alertPopup').dataset.remaining=JSON.stringify(items.slice(1))}
async function monitorAndShowAlerts(){await api('/api/monitor',{method:'POST'}).catch(()=>{});try{const {alerts}=await api('/api/alerts');showAlertQueue(alerts)}catch{}}

async function render(){document.body.classList.toggle('workbench-mode',['dashboard','evolution','archive','validation'].includes(state.page));if(state.page==='stock')return renderStock();const routes={dashboard,evolution:evolutionPage,archive:researchArchivePage,validation:validationPage,legacyDashboard,watchlist,search:searchPage,aiChat:aiChatPage,aiScreen:aiScreenPage,volumeScreen:volumeScreenPage,prediction:predictionPage,decisions,risks,events,portfolio,calculator,theses,brief,settings,admin:adminPage};await routes[state.page]?.();if(state.page==='volumeScreen')wbPaintUpdate()}

/* Opportunity-first workbench. Existing research, screening and portfolio routes remain available. */
function wb(){return globalThis.AllenWorkbench}
function wbValue(value,d=2){return Number.isFinite(value)?value.toFixed(d):'未记录'}
function wbPrice(value){return Number.isFinite(value)&&value>0?'¥'+value.toFixed(2):'待核验'}
function wbDate(value){return value?String(value).replace('T',' ').slice(0,19):'未记录'}
function wbUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return''}}
function resetWorkbenchState(){
 wbRefreshController?.cancel();wbRefreshController=null;state.wbLatestScan=null;state.volumeReadEpoch=(state.volumeReadEpoch||0)+1;
 state.wb=null;state.wbEpoch=(state.wbEpoch||0)+1;state.wbFilter='all';state.archiveId=null;
 state.archiveRecord=null;state.archiveMode='original';state.archiveContext=null;
}
async function wbLoad(page){
 const owner=currentUser,epoch=state.wbEpoch=(state.wbEpoch||0)+1;
 const names=['scan','history','events','context','model'];
 const paths=['/api/volume-screen/latest','/api/research-history','/api/ai/radar-history','/api/workbench/context','/api/model/status'];
 const settled=await Promise.allSettled(paths.map(path=>api(path)));
 if(currentUser!==owner||state.page!==page||state.wbEpoch!==epoch)return null;
 const result={errors:{},loadedAt:new Date().toISOString()};
 settled.forEach((entry,i)=>{
   if(entry.status==='rejected'){result.errors[names[i]]=entry.reason?.message||'请求失败';return}
   const data=entry.value;
   const valid=i===0?data&&Object.hasOwn(data,'result'):
     i===1?Array.isArray(data?.items):i===2?Array.isArray(data?.reports):
     i===3?typeof data?.verified==='boolean':data&&typeof data==='object'&&Object.hasOwn(data,'active');
   if(!valid){result.errors[names[i]]='响应格式不完整，无法核验';return}
   result[names[i]]=i===0?data.result:i===1?data.items:i===2?data.reports:data;
 });
 if(state.wbLatestScan&&(!result.scan||Date.parse(state.wbLatestScan.createdAt)>=Date.parse(result.scan.createdAt))){result.scan=state.wbLatestScan;result.scanFromMemory=true}
 result.context=result.context||{verified:false,expectedThrough:null};
 result.cards=wb().cards(result.scan,result.history||[],result.context);
 state.wb=result;return result;
}

let wbRefreshController=null;
function wbScanButton(){
 const s=wbRefreshController?.state,busy=wbRefreshController?.busy();
 return '<button class="wb-button primary" data-wb-update '+(busy?'disabled aria-busy="true"':'')+'>'+(busy?'正在更新…':s?.phase==='error'&&s.jobId?'继续读取进度':'更新机会')+'</button>';
}
function wbUpdateStatus(){
 const s=wbRefreshController?.state;
 if(!s||s.phase==='idle')return '';
 if(s.phase==='error')return '<p class="wb-warning">更新未完成：'+esc(s.error)+'。下方历史记录仍保留，不能据此判断没有机会。</p>';
 if(s.phase==='finishing')return '<p class="wb-update-done">扫描已结束，正在整理本次记录…</p>';
 if(s.phase==='done'){
  const usable=s.result?.coverage?.usable;
  return '<p class="'+(usable===0?'wb-warning':'wb-update-done')+'">'+(usable===0?'扫描结束，但数据不足，无法完成判断。历史卡片仅供留档复核，不代表本次新增机会。':'本次扫描结束，请按确认条件继续研究。')+
   (s.result?.storage?.durable===true?' 结果已保存。':' 本次结果未留档，保存状态未确认。')+(s.error?' '+esc(s.error):'')+'</p>';
 }
 const p=s.progress,known=Number.isFinite(p?.total),checked=Number.isFinite(p?.checked)?p.checked:null;
 return '<div class="wb-update-running"><b>正在更新机会</b><p>'+
  (known?'已核验 '+wbValue(checked,0)+' / '+wbValue(p.total,0)+'；失败 '+wbValue(p.failed,0):
   '正在连接扫描任务；实际覆盖数量以服务返回为准。')+
  '</p><small>可以切换页面；正在重试同一任务时不会重复启动。'+esc(s.error||'')+'</small></div>';
}
function wbPaintUpdate(){
 if(['dashboard','evolution'].includes(state.page)){
  const box=$('#wbUpdateStatus');if(box)box.innerHTML=wbUpdateStatus();
  for(const button of document.querySelectorAll('[data-wb-update]')){
   button.disabled=!!wbRefreshController?.busy();button.setAttribute('aria-busy',String(button.disabled));button.textContent=button.disabled?'正在更新…':wbRefreshController?.state.phase==='error'&&wbRefreshController.state.jobId?'继续读取进度':'更新机会';
  }
 }
 if(state.page==='volumeScreen'){
  const button=$('#volumeScreenForm button'),box=$('#volumeScreenResult');
  if(button){button.disabled=!!wbRefreshController?.busy();button.textContent=button.disabled?'正在更新…':'更新机会'}
  if(box&&wbRefreshController?.busy())box.innerHTML=wbUpdateStatus();
  else if(box&&wbRefreshController?.state.phase==='error')box.innerHTML=wbUpdateStatus()+(state.volumeScreen?volumeScreenResults(state.volumeScreen):'');
  else if(box&&wbRefreshController?.state.phase==='done')box.innerHTML=wbUpdateStatus()+(state.volumeScreen?volumeScreenResults(state.volumeScreen):'');
 }
}
async function wbStartUpdate(){
 const owner=currentUser;
 if(!owner)return;
 if(!wbRefreshController){
  wbRefreshController=new globalThis.AllenOpportunityRefresh({
   start:()=>api('/api/volume-screen',{method:'POST',body:JSON.stringify({limit:1200})}),
   read:id=>api('/api/volume-screen/jobs/'+encodeURIComponent(id)),
   onChange:()=>{if(currentUser===owner)wbPaintUpdate()},
   onDone:async result=>{
    if(currentUser!==owner)return;
    state.wbLatestScan=result;state.volumeScreen=result;
    if(['dashboard','evolution','volumeScreen'].includes(state.page))await render();
   }
  });
 }
 await wbRefreshController.run();
}

function wbHeader(kicker,title,detail,actions=''){
 return '<section class="wb-page-heading"><div><p class="eyebrow">'+esc(kicker)+'</p><h2>'+esc(title)+'</h2><p>'+esc(detail)+'</p></div><div class="wb-actions">'+actions+'</div></section>';
}
function wbStatus(data){
 const scan=wb().scanState(data.scan,data.errors.scan),c=wb().coverage(data.scan);
 const stale=data.scan&&data.context.verified&&c.range?.[0]<data.context.expectedThrough;
 return '<section class="wb-data-strip" role="status">'+(data.scan&&data.scan.storage?.durable!==true?'<p class="wb-warning">本次扫描保存状态未确认；研究档案只使用实际留档，不补造历史。</p>':'')+'<div><span class="wb-state '+esc(scan.key)+'">'+esc(stale?'历史扫描·待刷新':scan.label)+'</span><b>数据截止 '+esc(c.range?.join(' 至 ')||'未记录')+'</b></div><p>上次扫描：请求 '+wbValue(c.requested,0)+' · 返回 '+wbValue(c.returned,0)+' · 失败 '+wbValue(c.failed,0)+' · 可判断 '+wbValue(c.usable,0)+'（'+wbValue(c.pct,1)+'%）</p><small>应有完整日线 '+esc(data.context.expectedThrough||'待核验')+' · 保存于 '+esc(wbDate(data.scan?.createdAt))+'</small><details><summary>查看范围、失败原因与限制</summary><p>'+esc(scan.detail)+'</p><p>结构观察 '+wbValue(c.observations,0)+' 条；本次展示 '+c.displayed+' 条。原有筛选最多展示60条，研究历史入口返回最近200条；均不代表全市场。</p><p>合格候选：未判定。T1＋1.5 配置不兼容，T2 未启用；结构观察单独保留。</p>'+
 c.failures.slice(0,15).map(f=>'<p>'+esc(f.symbol||'数据源')+' · '+esc(f.code||'原因未知')+' · '+esc(f.message||'未记录')+'</p>').join('')+
 Object.entries(data.errors).map(([name,message])=>'<p class="wb-warning">'+esc(({scan:'量价记录',history:'研究历史',events:'事件记录',context:'时效核验',model:'模型状态'})[name])+'：'+esc(message)+'</p>').join('')+
 (c.failures.length>15?'<p>另有 '+(c.failures.length-15)+' 条；请到量价筛选查看完整原因。</p>':'')+'</details></section>';
}
function wbCondition(item){
 const level=item.original?.levels||item.levels||{},current=item.levels||{};
 if(item.phase?.key==='paused')return '先取得最新完整日线并核验数据；暂停新的确认与失效判断。';
 if(item.channel==='radar')return '核对原公告的计划、交付或收入证据；再独立核验价格与成交量。';
 return '完整日线收盘 ≥ '+wbPrice(current.breakout)+'，且当日成交量达到此前20日均量的1.5倍；趋势先后与正式资格仍待核验。';
}
function wbInvalidation(item){
 if(item.researchStatus==='invalidated')return '已留档失效；保留原始判断和后续失败记录，新机会须另建编号。';
 if(item.channel==='radar')return item.original?.invalidation||item.invalidation||'原公告条件未留存，需复核原文。事件期限结束不等于盈利。';
 const stop=item.original?.levels?.stop??item.levels?.stop;
 return '有效完整日线收盘 ≤ '+wbPrice(stop)+'，结束原结构假设；数据缺失不判失效。止损条件不保证能按该价成交。';
}
function wbStatusText(value){return ({tracking:'持续跟踪',review:'需要复核',invalidated:'已失效',closed:'研究已结束',expired:'已到期'})[value]||'状态待核验'}
function wbEventText(value){return ({created:'首次发现',refreshed:'更新观察',data_gap:'数据缺口',invalidated:'失效／到期',note:'复核笔记'})[value]||'追加观察'}
function wbMiniChart(item){
 const a=item.original,b=item;
 if(!item.observationSaved||!a||a.data?.state!=='ok'||b.data?.state!=='ok'||!Number.isFinite(a.price)||!Number.isFinite(b.price)||!(a.price>0&&b.price>0)||!wb().date(a.dataThrough)||!wb().date(b.dataThrough)||a.dataThrough>=b.dataThrough)
   return '<div class="wb-mini-observations"><small>最新观察 '+wbPrice(b.price)+' · '+esc(b.dataThrough||'截止未知')+'</small><small>历史价格点不足，未生成示意走势。</small></div>';
 const rise=b.price>=a.price,y1=rise?29:7,y2=rise?7:29;
 return '<div class="wb-mini-observations"><div><span>原始 '+wbPrice(a.price)+' <small>'+esc(a.dataThrough)+'</small></span><svg viewBox="0 0 120 36" aria-label="仅原始与最新两个价格观测点"><line x1="8" y1="'+y1+'" x2="112" y2="'+y2+'"/><circle cx="8" cy="'+y1+'" r="3"/><circle cx="112" cy="'+y2+'" r="3"/></svg><span>最新 '+wbPrice(b.price)+' <small>'+esc(b.dataThrough)+'</small></span></div><small>仅比较两次留档观测，不是每日走势或收益。</small></div>';
}
function wbCard(item,compact=false){
 const facts=wb().facts(item),support=facts.filter(x=>x.state==='supported');
 const note=item.channel==='radar'?(item.rationale||item.original?.rationale||'公告线索待核验'):
   support.length?support.map(x=>x.title).slice(0,2).join('、')+'有留档依据；上涨趋势仍需先核验。':'原扫描证据不完整，先核对条件。';
 return '<article class="wb-opportunity '+esc(item.phase.key)+(compact?' compact':'')+'" data-wb-card="'+esc(item.viewId)+'"><div class="wb-card-top"><span class="wb-stage">'+esc(item.phase.label)+'</span><span>'+esc(item.channel==='radar'?'事件渠道':'量价渠道')+'</span></div><h3>'+esc(item.name||item.symbol)+' <small>'+esc(item.code||item.symbol)+'</small></h3>'+wbMiniChart(item)+'<p class="wb-card-reason">'+esc(note)+'</p><dl><dt>还差什么</dt><dd>'+esc(wbCondition(item))+'</dd><dt>首要疑点</dt><dd>'+esc(item.channel==='radar'?'事件利好尚不能证明价格确认或未来收益。':facts[0].basis)+'</dd><dt>何时放弃</dt><dd>'+esc(wbInvalidation(item))+'</dd></dl><div class="wb-card-foot"><small>'+esc(item.dataThrough||'截止未知')+' · '+esc(item.quality.label)+'</small><button class="wb-link" data-wb-open="'+esc(item.viewId)+'">研究档案 →</button></div></article>';
}
function wbEventChannel(data){
 const report=data.events?.[0],ideas=report?.candidates||[];
 return '<section class="wb-panel wb-events"><div class="wb-section-title"><div><span class="wb-overline">独立发现渠道</span><h3>事件雷达</h3></div><button class="wb-link" data-go="aiScreen">进入雷达 →</button></div><p class="wb-muted">公告计划提供研究线索，价格确认另行判断。</p>'+
 (data.errors.events?'<p class="wb-warning">事件记录无法读取：'+esc(data.errors.events)+'</p>':
 ideas.slice(0,3).map(idea=>'<article><span>事件线索 · '+esc(report.window?.start||'日期未知')+'</span><h4>'+esc(idea.name||idea.symbol)+'</h4><p>'+esc(idea.rationale||'受益理由未留存，请核验原公告。')+'</p><button class="wb-link" data-stock="'+esc(idea.symbol)+'" data-name="'+esc(idea.name)+'">公司研究 →</button></article>').join('')||'<p>暂无已保存的事件候选。可以继续等待，或手动运行事件雷达。</p>')+
 '<small>这里只显示最近报告的前3条线索；全部候选、排除理由和失败情况保留在原雷达。</small></section>';
}
function wbRiskRail(data){
 const risks=data.cards.filter(c=>['invalid','paused'].includes(c.phase.key)||c.researchStatus==='review').sort((a,b)=>(a.phase.key==='invalid'?0:a.researchStatus==='review'?1:2)-(b.phase.key==='invalid'?0:b.researchStatus==='review'?1:2)||String(a.symbol).localeCompare(String(b.symbol)));
 return '<section class="wb-panel wb-risk-rail"><div class="wb-section-title"><div><span class="wb-overline">先处理风险</span><h3>需要复核 '+risks.length+' 条</h3></div><span aria-hidden="true">↗</span></div>'+
 (risks.slice(0,4).map(item=>'<button class="wb-risk-row" data-wb-open="'+esc(item.viewId)+'"><span class="wb-risk-icon">'+(item.phase.key==='invalid'?'×':'!')+'</span><span><b>'+esc(item.name||item.symbol)+'</b><small>'+esc(item.phase.reason)+'</small></span><em>'+esc(item.phase.label)+'</em></button>').join('')||'<p>当前返回记录中没有待复核条目；这不代表持仓没有风险。</p>')+
 '<p class="wb-budget">个人风险预算 <b>待设置</b><small>未生成个人仓位建议。</small></p></section>';
}
async function dashboard(){
 document.body.classList.remove('dashboard-mode');$('#content').innerHTML='<div class="wb-loading">正在读取研究记录与数据状态…</div>';
 const data=await wbLoad('dashboard');if(!data)return;
 const blocked=['failed','insufficient'].includes(wb().scanState(data.scan,data.errors.scan).key);
 const active=blocked?[]:data.cards.filter(c=>!['invalid','paused','event'].includes(c.phase.key)&&!wb().ended(c.researchStatus));
 const focus=active[0]||data.cards.find(c=>c.phase.key==='paused'&&!wb().ended(c.researchStatus));
 const title=blocked?'先核验数据，暂停新判断。':focus?(focus.phase.key==='paused'?'先核验 '+(focus.name||focus.symbol):'先研究 '+(focus.name||focus.symbol)):'今天，可以继续等。';
 $('#content').innerHTML=wbHeader('ALLEN / OPPORTUNITY DESK','今日机会','发现理由 → 等待确认 → 跟踪变化 → 及时复核',
   '<button class="wb-button secondary" data-wb-refresh>读取已存记录</button>'+wbScanButton())+
 '<section class="wb-hero"><div class="wb-hero-main"><span class="wb-overline">短期机会优先 · 先看证据</span><h2>'+esc(title)+'</h2><p>'+esc(focus?focus.phase.reason:'没有充分证据时不强行推荐股票。先检查数据覆盖，再判断是否值得关注。')+'</p><div class="wb-hero-tags"><span>正式资格：未判定</span><span>风险预算：待设置</span><span>不展示未经验证的概率</span></div>'+(focus?'<button class="wb-button light" data-wb-open="'+esc(focus.viewId)+'">打开这条研究 →</button>':'<button class="wb-button light" data-go="search">研究指定股票 →</button>')+'</div><div class="wb-hero-checklist"><div><span>01 / 还差什么</span><p>'+esc(focus?wbCondition(focus):'先取得完整行情、确定观察范围，再核验上涨趋势与阶段先后。')+'</p></div><div><span>02 / 什么时候放弃</span><p>'+esc(focus?wbInvalidation(focus):'原假设的失效条件必须先明确；数据失败时暂停判断。')+'</p></div></div></section>'+
 '<div id="wbUpdateStatus" role="status" aria-live="polite">'+wbUpdateStatus()+'</div>'+wbStatus(data)+'<div class="wb-home-grid"><section class="wb-candidate-area"><div class="wb-section-title"><div><span class="wb-overline">先关注谁 / 为什么</span><h3>优先研究清单</h3></div><button class="wb-link" data-go="evolution">机会演化图 →</button></div><p class="wb-muted">首页最多展示3条重点观察，不是收益排名；完整候选、失效及历史记录在演化图保留。</p><div class="wb-card-grid">'+
 (active.slice(0,3).map(item=>wbCard(item)).join('')||'<div class="wb-empty"><span aria-hidden="true">◎</span><h3>'+esc(wb().scanState(data.scan,data.errors.scan).label)+'</h3><p>历史或待核验记录保留在右侧和演化图；没有可用数据时不显示“没有机会”。</p></div>')+
 '</div></section><aside>'+wbRiskRail(data)+wbEventChannel(data)+'</aside></div>'+
 '<section class="wb-tools"><h3>继续你的研究</h3><div>'+[['watchlist','我的股票池'],['aiChat','AI研究对话'],['prediction','趋势与结构研究'],['decisions','条件式价格计划'],['portfolio','持仓与费用'],['theses','研究卡与投资逻辑'],['brief','每日简报'],['validation','验证与限制'],['legacyDashboard','经典概览']].map(([id,name])=>'<button data-go="'+id+'">'+name+' ↗</button>').join('')+'</div></section>'+disclaimer();
}
async function evolutionPage(){
 $('#content').innerHTML='<div class="wb-loading">正在读取机会阶段…</div>';
 const data=await wbLoad('evolution');if(!data)return;wbRenderEvolution(data);
}
function wbRenderEvolution(data){
 const stages=['trend','pullback','compression','trigger','follow'],filter=state.wbFilter||'all';
 const shown=data.cards.filter(item=>filter==='all'||item.phase.key===filter);
 const populated=stages.filter(key=>shown.some(c=>c.phase.key===key));
 const visible=filter==='all'?populated:stages.filter(key=>filter===key);
 const absent=stages.filter(key=>!populated.includes(key));
 $('#content').innerHTML=wbHeader('ALLEN / EVOLUTION MAP','机会演化图','阶段可以倒退、暂停、到期和失效；走到最后不表示盈利。',
 '<button class="wb-button secondary" data-wb-refresh>读取已存记录</button>'+wbScanButton())+
 '<div class="wb-stage-principle"><b>先后关系必须有证据</b><p>上涨趋势、缩量回调、收窄整理、放量突破、后续验证是待检验路径。旧扫描未留存完整顺序，所以当前没有“整套策略已确认”的绿色通行证。</p></div>'+
 '<div id="wbUpdateStatus" role="status" aria-live="polite">'+wbUpdateStatus()+'</div>'+wbStatus(data)+'<div class="wb-filter" role="group" aria-label="机会阶段筛选">'+[['all','全部'],...Object.entries(wb().labels).filter(([k])=>k!=='event')].map(([key,name])=>'<button aria-pressed="'+(filter===key)+'" class="'+(filter===key?'active':'')+'" data-wb-filter="'+key+'">'+name+' <small>'+data.cards.filter(c=>key==='all'||c.phase.key===key).length+'</small></button>').join('')+'</div>'+
 '<p class="wb-muted">有记录的阶段优先展开；这不是必须按顺序完成的盈利路径。</p><div class="wb-board">'+visible.map(key=>'<section class="wb-lane"><div class="wb-lane-heading"><span aria-hidden="true">'+esc(({trend:'◇',pullback:'↘',compression:'≈',trigger:'↗',follow:'◌'})[key])+'</span><h3>'+esc(wb().labels[key])+'</h3><b>'+shown.filter(c=>c.phase.key===key).length+'</b></div>'+shown.filter(c=>c.phase.key===key).map(item=>wbCard(item,true)).join('')+(!shown.some(c=>c.phase.key===key)?'<p class="wb-lane-empty">没有已记录候选，继续等待。</p>':'')+'</section>').join('')+'</div>'+
 (filter==='all'&&absent.length?'<details class="wb-absent-stages"><summary>查看尚无记录的阶段（'+absent.length+'）</summary><div>'+absent.map(key=>'<section><b>'+esc(wb().labels[key])+'</b><p>没有已留档候选；继续等待或补齐证据。</p></section>').join('')+'</div></details>':'')+
 ['paused','invalid'].filter(key=>filter==='all'||filter===key).map(key=>'<section class="wb-ended"><div class="wb-section-title"><h3>'+esc(wb().labels[key])+' · 保留全部返回记录</h3><b>'+shown.filter(c=>c.phase.key===key).length+'</b></div><div class="wb-ended-grid">'+shown.filter(c=>c.phase.key===key).map(item=>wbCard(item,true)).join('')+'</div></section>').join('')+
 wbEventChannel(data)+disclaimer();
}
function wbChart(record,mode){
 const points=wb().points(record,mode),levels=record.original.levels||{},refs=[['原突破',levels.breakout],['原失效',levels.stop],['T1结构参考',levels.target1]].filter(([,v])=>Number.isFinite(v)&&v>0);
 if(!points.length)return '<div class="wb-chart-empty">没有足够的真实留档价格点，未绘制模拟走势。</div>';
 const prices=[...points.map(p=>p.price),...refs.map(([,v])=>v)],min=Math.min(...prices),max=Math.max(...prices),span=max-min||1;
 const start=Date.parse(points[0].date),end=Date.parse(points.at(-1).date),range=end-start||1;
 const x=p=>points.length===1?320:60+(Date.parse(p.date)-start)/range*520,y=v=>200-(v-min)/span*150;
 return '<div class="wb-research-chart"><svg viewBox="0 0 700 245" role="img" aria-label="原始价位与留档价格观测，不是完整日线">'+
 [50,100,150,200].map(v=>'<line x1="45" x2="595" y1="'+v+'" y2="'+v+'" class="wb-grid-line"/>').join('')+
 refs.map(([name,value])=>'<line x1="45" x2="595" y1="'+y(value)+'" y2="'+y(value)+'" class="wb-reference"/><text x="600" y="'+(y(value)+4)+'">'+esc(name)+' '+value.toFixed(2)+'</text>').join('')+
 (points.length>1?'<polyline class="wb-observation-line" points="'+points.map(p=>x(p)+','+y(p.price)).join(' ')+'"/>':'')+
 points.map(p=>'<circle cx="'+x(p)+'" cy="'+y(p.price)+'" r="6" class="wb-observation-point"/><text x="'+(x(p)-20)+'" y="230">'+p.date.slice(5)+'</text>').join('')+
 '</svg><p>虚线仅连接已留档观测点，不是每日K线、预测路径或实际成交记录。原关键价位固定保留。</p></div>';
}
function wbFactRows(snapshot){
 return wb().facts(snapshot).map(f=>'<button class="wb-fact '+f.state+'" data-wb-fact="'+f.id+'"><span>'+(f.state==='supported'?'✓':f.state==='contrary'?'!':'?')+'</span><div><b>'+esc(f.title)+'</b><small>'+esc(f.state==='supported'?'有字段支持':f.state==='contrary'?'条件未满足':'缺少证据')+'</small></div><em>计算依据 ↗</em></button>').join('');
}
async function wbOpen(id){
 const item=state.wb?.cards.find(c=>c.viewId===id);
 if(!item){toast('这条记录已变化，请刷新后再打开');return}
 state.archiveId=item.researchId;state.archiveItem=item;state.archiveRecord=null;state.archiveContext=null;state.archiveMode='original';
 go('archive');
}
async function researchArchivePage(){
 const owner=currentUser,id=state.archiveId,item=state.archiveItem;
 $('#content').innerHTML='<div class="wb-loading">正在核验原始研究快照…</div>';
 if(!id){$('#content').innerHTML=wbHeader('ALLEN / RESEARCH ARCHIVE',item?.name||'个股研究档案','原始快照不可用')+'<section class="wb-panel wb-warning"><h3>本条未持久留档，不能回到当时</h3><p>当前观察仍可研究，但没有真实原始快照时，不声称当时预测到了。</p><button class="wb-button secondary" data-go="volumeScreen">检查保存状态</button></section>';return}
 try{
   const record=state.archiveRecord||await api('/api/research-history/'+encodeURIComponent(id));
   if(currentUser!==owner||state.page!=='archive'||state.archiveId!==id)return;
   if(!record.original||record.snapshotVerified!==true)throw Error('原始快照未通过完整性核验，暂停回放');
   state.archiveRecord=record;wbRenderArchive();
 }catch(error){if(currentUser!==owner||state.page!=='archive')return;$('#content').innerHTML=wbHeader('ALLEN / RESEARCH ARCHIVE',item?.name||'个股研究档案','记录读取失败')+'<section class="wb-panel wb-warning"><h3>原始记录暂不可读取</h3><p>'+esc(error.message)+'</p><button class="wb-button secondary" data-go="archive">重试</button></section>'}
}
function wbRenderArchive(){
 const record=state.archiveRecord,view=wb().asOf(record,state.archiveMode),snapshot=view.snapshot,original=record.original,levels=original.levels||{},later=view.mode==='later';
 const name=original.name||original.symbol,through=snapshot.dataThrough||snapshot.data?.dataThrough||'未记录';
 const phase=later?wbStatusText(record.events?.at(-1)?.payload?.status):'当时原始快照';
 $('#content').innerHTML=wbHeader('ALLEN / RESEARCH ARCHIVE',name+' · 研究档案','同一股票的新机会使用不同研究编号；原始条件固定，变化只追加。',
 '<button class="wb-button secondary" data-go="evolution">← 演化图</button><button class="wb-button primary" data-stock="'+esc(original.symbol)+'" data-name="'+esc(name)+'">完整公司研究 →</button>')+
 '<section class="wb-archive-title"><div><span class="wb-state">'+esc(later?'后来记录 · 非实盘收益':'真实留档 · 当时判断')+'</span><p>研究编号 '+esc(record.researchId)+'</p><small>生成 '+esc(wbDate(record.generatedAt))+' · 数据截止 '+esc(through)+'</small></div><div class="wb-time-switch" role="group" aria-label="研究时间切换"><button aria-pressed="'+!later+'" data-wb-time="original">回到当时</button><button aria-pressed="'+later+'" data-wb-time="later">后来记录与结果</button></div></section>'+
 '<div class="wb-archive-grid"><section><article class="wb-panel"><div class="wb-section-title"><h3>'+esc(later?'后来发生了什么':'当时知道什么')+'</h3><span>'+esc(phase||'状态未记录')+'</span></div>'+
 (later?'<p class="wb-muted">仅对照实际保存的后续观察和笔记；不将价格变化包装成交易收益。</p>':'<p class="wb-muted">本页只使用原始快照。没有当时的K线、笔记或阶段顺序，就明确留空。</p>')+
 wbChart(record,view.mode)+'<div class="wb-chart-markers"><button data-wb-marker="original">● '+esc(original.dataThrough||'日期未知')+' 原始判断</button>'+
 view.events.map((event,i)=>'<button data-wb-marker="'+i+'">'+esc(event.data_through||'日期未知')+' · '+esc(({created:'首次发现',refreshed:'更新观察',data_gap:'数据缺口',invalidated:'失效／到期',note:'复核笔记'})[event.kind]||event.kind)+'</button>').join('')+'</div></article>'+
 '<section class="wb-panel wb-evidence"><div class="wb-section-title"><h3>支持证据与疑点</h3><span>点击查看具体计算依据</span></div><div class="wb-fact-grid">'+wbFactRows(snapshot)+'</div></section>'+
 (later?'<section class="wb-panel"><h3>追加记录 · 包含失败与未验证状态</h3>'+view.events.map(event=>'<article class="wb-history-row"><time>'+esc(wbDate(event.occurred_at))+'</time><div><b>'+esc(wbEventText(event.kind))+' · '+esc(wbStatusText(event.payload?.status))+'</b><p>'+esc(event.payload?.note||'行情与条件观察；未记录成交或策略收益')+'</p><small>数据截止 '+esc(event.data_through||'未记录')+'</small></div></article>').join('')+
 '<form class="wb-note" data-id="'+esc(record.researchId)+'" data-request="'+crypto.randomUUID()+'"><label for="wbNote">追加复核笔记</label><textarea id="wbNote" name="note" maxlength="1000" required placeholder="新证据是什么？原判断需要怎样调整？"></textarea><button class="wb-button primary" type="submit">追加保存</button><p class="wb-note-status" role="status"></p></form></section>':
 '<section class="wb-panel"><h3>当时笔记</h3><p>原始快照未包含生成时的用户笔记。后续追加笔记只在“后来记录与结果”中展示。</p></section>')+
 '</section><aside><section class="wb-panel wb-original-plan"><span class="wb-overline">原始条件 · 不随扫描漂移</span><h3>确认与放弃</h3><dl><dt>原入场参考</dt><dd>'+wbPrice(levels.entry)+'</dd><dt>原突破参考</dt><dd>'+wbPrice(levels.breakout)+'</dd><dt>原始失效价</dt><dd>'+wbPrice(levels.stop)+'</dd><dt>T1 结构参考</dt><dd>'+wbPrice(levels.target1)+'</dd><dt>原风险收益比 RR1</dt><dd>'+wbValue(levels.rr1,4)+'</dd></dl><p>'+esc(wbCondition({...original,phase:{key:'original'}}))+'</p><p class="wb-warning">'+esc(wbInvalidation({original,channel:state.archiveItem?.channel}))+'</p><small>T1是结构参考，不是收益承诺。T2未启用，正式资格未判定。跳空、跌停、停牌或T+1可能影响退出。</small><div class="wb-budget">风险预算 <b>待设置</b></div></section>'+
 '<section class="wb-panel wb-provenance"><h3>原始记录凭据</h3><p>策略版本 '+esc(record.strategyVersion||'未记录')+'</p><p>价格定义 '+esc(record.calculationVersion||'未记录')+'</p><p>扫描编号 '+esc(record.sourceScanId||'未记录')+'</p><small>快照校验通过</small><code>'+esc(record.snapshotHash)+'</code></section>'+
 '<section class="wb-panel"><h3>连接公司、财务与行业</h3><p>最新资料单独标注读取时间，不混入当时判断。</p><button class="wb-button secondary" data-wb-context>读取当前公司资料</button><div id="wbCurrentContext">'+(state.archiveContext?wbCurrentContextHtml(state.archiveContext):'')+'</div></section></aside></div>'+disclaimer();
}
function wbCurrentContextHtml(context){
 const research=context.research?.value,stock=context.stock?.value,f=research?.finance,company=research?.company;
 return '<div class="wb-current-context"><b>最新读取 · '+esc(wbDate(context.at))+'</b><p>以下不是当时已知资料，也不回填原始判断。</p>'+
 (context.stock?.status==='rejected'?'<p class="wb-warning">行情未取得：'+esc(context.stock.reason?.message)+'</p>':'<p>当前行情截止 '+esc(stock?.data?.dataThrough||'未知')+' · '+esc(stock?.data?.state||'未核验')+'</p>')+
 (context.research?.status==='rejected'?'<p class="wb-warning">公司资料未取得：'+esc(context.research.reason?.message)+'</p>':
 '<p>行业 '+esc(company?.industry||'未取得')+'</p><p>财务报告期 '+esc(f?.reportDate||f?.reportName||'未取得')+'</p><p>营收同比 '+wbValue(f?.revenueGrowth,1)+'% · 利润同比 '+wbValue(f?.profitGrowth,1)+'%</p>'+
 (research?.announcements||[]).slice(0,3).map(a=>'<article><small>'+esc(a.date)+'</small><p>'+esc(a.title)+'</p>'+(wbUrl(a.link)?'<a href="'+esc(wbUrl(a.link))+'" target="_blank" rel="noopener">核验原公告 ↗</a>':'')+'</article>').join(''))+'</div>';
}
function wbShowEvidence(snapshot,title,event){
 $('#wbEvidence')?.remove();
 const facts=wb().facts(snapshot);
 document.body.insertAdjacentHTML('beforeend','<dialog id="wbEvidence" class="wb-evidence-dialog"><button class="wb-close" data-wb-close>关闭 ×</button><p class="eyebrow">ALLEN / EVIDENCE</p><h2>'+esc(title)+'</h2><p>数据截止 '+esc(snapshot.dataThrough||snapshot.data?.dataThrough||'未记录')+'</p>'+
 (event?'<p>记录时间 '+esc(wbDate(event.occurred_at))+' · 类型 '+esc(event.kind)+'</p><p>'+esc(event.payload?.note||'')+'</p>':'')+
 facts.map(f=>'<section id="wb-fact-'+f.id+'"><h3>'+esc(f.title)+' · '+esc(({supported:'有字段支持',contrary:'条件未满足',unknown:'证据不足'})[f.state])+'</h3><p>'+esc(f.basis)+'</p><p>留存数值：'+wbValue(f.value,4)+' · 截止 '+esc(f.dataThrough||'未记录')+'</p><small>'+esc(f.source)+'</small></section>').join('')+
 '<p class="wb-warning">字段支持不代表整套策略有效；缺少历史顺序时不能补造确认。</p></dialog>');
 const dialog=$('#wbEvidence');dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
}
async function validationPage(){
 $('#content').innerHTML='<div class="wb-loading">正在读取验证状态…</div>';
 const data=await wbLoad('validation');if(!data)return;
 $('#content').innerHTML=wbHeader('ALLEN / VALIDATION','验证与限制','先看未参与训练的数据、扣费后表现和回撤；不按最高胜率挑模型。')+
 '<section class="wb-validation-hero"><span class="wb-state">研究可继续 · 收益优势未证明</span><h2>我们目前知道什么？</h2><p>可靠性测试检查数据、计算、保存和界面行为，不证明策略赚钱。正式短期策略、成交规则和风险预算仍待确定。</p></section><div class="wb-validation-grid">'+
 [['01','预测目标','上涨、跑赢基准、先止盈后止损是三个不同目标；尚未确认目标时不混成一个概率。'],
 ['02','公平验证','后续按时间划分、处理标签跨界、扣除成本并披露幸存者偏差。当前不展示未经验证的回测成绩。'],
 ['03','风险约束','风险预算待设置。止损参考不保证退出价格；需考虑跳空、停牌、跌停、T+1与流动性。'],
 ['04','完整公开','观察、失效、数据缺口、未预测及未成交都应保留；完成复盘不等于判断正确。']].map(([n,t,p])=>'<section class="wb-panel"><span class="wb-overline">'+n+'</span><h3>'+t+'</h3><p>'+p+'</p></section>').join('')+'</div>'+
 '<section class="wb-panel"><h3>短期离线核验工具</h3><p>已提供按时间隔离、逐目标比较和概率校准检查的工具；目前仅有合成自检，没有真实策略成绩。仓库原有报告主要针对20日，不能套用成一周上涨证据。</p><p>上涨与跑赢基准分别统计。先止盈后止损缺少成交时间顺序，暂不评估；组合回撤也未完成验证。</p><p>正式策略仍待确定，不自动训练、挑选或启用模型。</p></section>'+
 '<section class="wb-panel"><h3>当前模型与筛选状态</h3><p>'+esc(data.errors.model||data.model?.message||'当前模型验证说明未返回；不推断可用性。')+'</p><p>模型版本 '+esc(data.model?.version||'未返回')+' · 是否启用 '+(data.model?.active===true?'以模型清单逐周期核验':'当前未启用／未确认')+'</p><p>本研究台不把规则分、历史频率或模型排序展示成已验证的上涨概率。</p><p>T1＋1.5 配置不兼容，合格候选未判定；T2未启用。</p><button class="wb-button secondary" data-go="prediction">打开原趋势研究与记录</button></section>'+wbStatus(data)+disclaimer();
}

pageMeta.archive='个股研究档案';
document.addEventListener('click',async e=>{
 const open=e.target.closest('[data-wb-open]');if(open){await wbOpen(open.dataset.wbOpen);return}
 if(e.target.closest('[data-wb-update]')){await wbStartUpdate();return}
 if(e.target.closest('[data-wb-refresh]')){await render();return}
 const filter=e.target.closest('[data-wb-filter]');if(filter){state.wbFilter=filter.dataset.wbFilter;if(state.wb)wbRenderEvolution(state.wb);return}
 const time=e.target.closest('[data-wb-time]');if(time){state.archiveMode=time.dataset.wbTime==='later'?'later':'original';wbRenderArchive();return}
 if(e.target.closest('[data-wb-close]')){$('#wbEvidence')?.close();return}
 const fact=e.target.closest('[data-wb-fact]');
 if(fact&&state.archiveRecord){const view=wb().asOf(state.archiveRecord,state.archiveMode);wbShowEvidence(view.snapshot,'计算依据与证据缺口');$('#wb-fact-'+fact.dataset.wbFact)?.scrollIntoView({block:'nearest'});return}
 const marker=e.target.closest('[data-wb-marker]');
 if(marker&&state.archiveRecord){
   const record=state.archiveRecord,view=wb().asOf(record,state.archiveMode),i=Number(marker.dataset.wbMarker);
   const event=marker.dataset.wbMarker==='original'?null:view.events[i];
   if(marker.dataset.wbMarker!=='original'&&!event)return;
   wbShowEvidence(event?.payload?.snapshot||record.original,event?'后来记录的证据':'原始判断的证据',event);return;
 }
 if(e.target.closest('[data-wb-context]')){
   const owner=currentUser,id=state.archiveId,record=state.archiveRecord,button=e.target.closest('[data-wb-context]');
   if(!record)return;button.disabled=true;
   const [stock,research]=await Promise.allSettled([quote(record.original.symbol),api('/api/research/'+encodeURIComponent(record.original.symbol))]);
   if(currentUser!==owner||state.page!=='archive'||state.archiveId!==id)return;
   state.archiveContext={stock,research,at:new Date().toISOString()};
   $('#wbCurrentContext').innerHTML=wbCurrentContextHtml(state.archiveContext);button.disabled=false;return;
 }

 const historyButton=e.target.closest('[data-research-history]');
 if(historyButton){try{const record=await api('/api/research-history/'+encodeURIComponent(historyButton.dataset.researchHistory));$('#modal')?.remove();document.body.insertAdjacentHTML('beforeend',`<div id="modal" class="modal"><section class="card research-history-modal"><button data-close>关闭</button><h2>原始判断与追加记录</h2>${originalResearchHtml({...record,latest:record.events.at(-1)?.payload})}<pre>${esc(JSON.stringify(record.original,null,2))}</pre>${record.events.map(e=>`<p>${dateTime(e.occurred_at)} · ${esc(e.kind)} · ${esc(e.payload.status)} ${esc(e.payload.note||'')}</p>`).join('')}<form class="research-note" data-id="${esc(record.researchId)}" data-request="${crypto.randomUUID()}"><textarea class="input" name="note" required maxlength="1000" placeholder="填写新证据或复核笔记"></textarea><button type="submit">追加笔记</button></form></section></div>`)}catch(error){toast(error.message)}return}
 const predictionView=e.target.closest('[data-prediction-view]');
 if(predictionView){state.predictionView=predictionView.dataset.predictionView;if(state.page==='prediction')await predictionPage();return}
 const follow=e.target.closest('[data-radar-follow]');
 if(follow){follow.disabled=true;try{await api('/api/radar/journal',{method:'POST',body:JSON.stringify({reportId:state.aiScreen.id,symbol:follow.dataset.radarFollow})});follow.textContent='已加入投资逻辑档案'}catch(error){alert(error.message);follow.disabled=false}return}
 const check=e.target.closest('[data-journal-check]');
 if(check){check.disabled=true;try{await api('/api/radar/journal/'+encodeURIComponent(check.dataset.journalCheck)+'/check',{method:'POST',body:'{}'});await render()}catch(error){alert(error.message);check.disabled=false}return}
 const reportButton=e.target.closest('[data-radar-history]');
 if(reportButton){state.aiScreen=state.radarArchive?.[Number(reportButton.dataset.radarHistory)];await aiScreenPage();return}
 const page=e.target.closest('[data-page]')?.dataset.page||e.target.closest('[data-go]')?.dataset.go;if(page)return go(page);
 const stock=e.target.closest('[data-stock]');if(stock)return openStock(stock.dataset.stock,stock.dataset.name);
 const tab=e.target.closest('[data-tab]');if(tab){state.tab=tab.dataset.tab;renderStock();return}
 const add=e.target.closest('[data-add]');if(add){if(!state.watch.some(x=>x.symbol===add.dataset.add)){state.watch.push({symbol:add.dataset.add,code:add.dataset.code||add.dataset.add,name:add.dataset.name});store.set('watch',state.watch);toast('已加入股票池')}return}
 const rem=e.target.closest('[data-remove]');if(rem){state.watch=state.watch.filter(x=>x.symbol!==rem.dataset.remove);store.set('watch',state.watch);watchlist();return}
 if(e.target.closest('[data-modal]')){const type=e.target.closest('[data-modal]').dataset.modal;return type==='user'?userModal():type==='announcement'?announcementAdminModal():modal(type)}
 if(e.target.closest('[data-close]')||e.target.classList.contains('modal'))return $('#modal')?.remove();
 if(e.target.closest('[data-clear-chat]')){state.aiMessages=[];store.set('aiMessages',[]);aiChatPage();return}
 const ar=e.target.closest('[data-announcement-read]');if(ar){const popup=$('#announcementPopup'),remaining=JSON.parse(popup?.dataset.remaining||'[]');await api('/api/announcements/'+ar.dataset.announcementRead+'/read',{method:'POST'});popup?.remove();showAnnouncementQueue(remaining);return}
 if(e.target.closest('[data-announcement-later]')){$('#announcementPopup')?.remove();return}
 const alertRead=e.target.closest('[data-alert-read]');if(alertRead){const popup=$('#alertPopup'),remaining=JSON.parse(popup?.dataset.remaining||'[]');await api('/api/alerts/'+alertRead.dataset.alertRead+'/read',{method:'POST'});popup?.remove();showAlertQueue(remaining);return}
 if(e.target.closest('[data-alert-later]')){$('#alertPopup')?.remove();return}
 const at=e.target.closest('[data-announcement-toggle]');if(at){await api('/api/admin/announcements/'+at.dataset.announcementToggle,{method:'PATCH',body:JSON.stringify({action:'toggle'})});toast('通知状态已更新');adminPage();return}
 const suggestion=e.target.closest('[data-ai-question]');if(suggestion){const input=document.querySelector('#aiChatForm textarea');if(input){input.value=suggestion.dataset.aiQuestion;input.focus()}return}
 const dp=e.target.closest('[data-del-portfolio]');if(dp){state.portfolio.splice(+dp.dataset.delPortfolio,1);store.set('portfolio',state.portfolio);portfolio();return}
 const dt=e.target.closest('[data-del-thesis]');if(dt){state.theses.splice(+dt.dataset.delThesis,1);store.set('theses',state.theses);theses();return}
 const ut=e.target.closest('[data-user-toggle]');if(ut){await api('/api/admin/users/'+ut.dataset.userToggle,{method:'PATCH',body:JSON.stringify({action:'toggle'})});toast('用户状态已更新');adminPage();return}
 const ur=e.target.closest('[data-user-reset]');if(ur){const password=prompt('请输入至少6位的新密码');if(password){await api('/api/admin/users/'+ur.dataset.userReset,{method:'PATCH',body:JSON.stringify({action:'reset',password})});toast('密码已重置')}return}
 const uf=e.target.closest('[data-user-force]');if(uf){if(confirm('确定让这个用户的所有设备立即退出吗？')){await api('/api/admin/users/'+uf.dataset.userForce,{method:'PATCH',body:JSON.stringify({action:'forceLogout'})});toast('该用户已被强制下线');adminPage()}return}
 if(e.target.closest('[data-backup]')){try{const res=await fetch('/api/admin/backup');if(!res.ok)throw new Error((await res.json().catch(()=>({}))).error||'导出失败');const backup=await res.json();if(!backup.tables||!Array.isArray(backup.unavailable))throw Error('备份内容格式异常');const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`allen-stock-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(backup.unavailable.length?'已下载部分备份，缺少：'+backup.unavailable.join('、'):'安全备份已下载')}catch(err){toast(err.message)}return}
 if(e.target.id==='settingsLogout')return logout();
});
document.addEventListener('submit',async e=>{
 if(e.target.matches('.wb-note')){
   e.preventDefault();
   const form=e.target,owner=currentUser,id=form.dataset.id,button=form.querySelector('button'),status=form.querySelector('.wb-note-status');
   const note=new FormData(form).get('note');button.disabled=true;status.textContent='正在追加保存…';let saved=false;
   try{
     await api('/api/research-history/'+encodeURIComponent(id)+'/notes',{method:'POST',body:JSON.stringify({requestKey:form.dataset.request,note})});saved=true;
     const record=await api('/api/research-history/'+encodeURIComponent(id));
     if(currentUser!==owner||state.page!=='archive'||state.archiveId!==id)return;
     state.archiveRecord=record;wbRenderArchive();$('.wb-note-status').textContent='笔记已追加，原始条件与校验值未改变。';
   }catch(error){
     if(currentUser!==owner||state.page!=='archive'||state.archiveId!==id)return;
     status.textContent=(saved?'笔记已提交，但最新记录读取失败：':'保存未确认，请保留文字后重试：')+error.message;button.disabled=false;
   }
   return;
 }

 if(e.target.matches('.research-note')){e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;try{await api('/api/research-history/'+encodeURIComponent(form.dataset.id)+'/notes',{method:'POST',body:JSON.stringify({requestKey:form.dataset.request,note:new FormData(form).get('note')})});toast('笔记已追加，原始快照未改变');$('#modal')?.remove()}catch(error){toast('保存失败：'+error.message);button.disabled=false}return}
 if(e.target.matches('.journal-review')){e.preventDefault();const form=e.target,button=form.querySelector('button');button.disabled=true;try{await api('/api/radar/journal/'+encodeURIComponent(form.dataset.journalId)+'/review',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});await render()}catch(error){alert(error.message);button.disabled=false}return}
 e.preventDefault();
 if(e.target.id==='loginForm'){try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({username:$('#username').value,password:$('#password').value})});currentUser=result.user;loadUserState();await loadCloudState();$('#login').classList.add('hidden');$('#shell').classList.remove('hidden');go('dashboard');startPresence();showUnreadAnnouncements();monitorAndShowAlerts()}catch(err){$('#loginError').textContent=err.message}return}
 if(e.target.id==='searchForm')return doSearch($('#searchInput').value.trim());
 if(e.target.id==='aiChatForm'){const button=e.target.querySelector('button[type="submit"]'),d=Object.fromEntries(new FormData(e.target)),history=state.aiMessages.slice(-6);state.aiMessages.push({role:'user',content:d.question});store.set('aiMessages',state.aiMessages);button.disabled=true;button.textContent='AI 分析中…';try{const result=await api('/api/ai/chat',{method:'POST',body:JSON.stringify({symbol:d.symbol,question:d.question,history})});state.aiMessages.push({role:'assistant',content:result.answer});store.set('aiMessages',state.aiMessages);await aiChatPage()}catch(err){state.aiMessages.push({role:'assistant',content:'暂时无法回答：'+err.message});store.set('aiMessages',state.aiMessages);await aiChatPage()}return}
 if(e.target.id==='aiScreenForm'){const owner=currentUser,box=$('#screenResult'),button=e.target.querySelector('button[type="submit"]'),d=Object.fromEntries(new FormData(e.target));state.aiScreenCriteria=d;store.set('aiScreenCriteria',d);button.disabled=true;button.textContent='扫描进行中…';box.innerHTML=loading();try{const result=await api('/api/ai/screen',{method:'POST',body:JSON.stringify(d)});if(currentUser!==owner)return;await pollRadar(result.jobId,owner)}catch(err){if(currentUser===owner&&state.page==='aiScreen')box.innerHTML=`<div class="card empty">${esc(err.message)}</div>`}finally{button.disabled=false;button.textContent='扫描并核验证据'}return}
 if(e.target.id==='volumeScreenForm'){await wbStartUpdate();return}
 if(e.target.id==='predictionForm'){const box=$('#predictionResult'),button=e.target.querySelector('button[type="submit"]'),d=Object.fromEntries(new FormData(e.target));button.disabled=true;button.textContent='正在读取量价结构…';box.innerHTML=loading();try{state.predictionView='structure';state.prediction=await api('/api/prediction',{method:'POST',body:JSON.stringify(d)});predictionPage()}catch(err){box.innerHTML=`<div class="card empty"><h2>暂时无法完成结构分析</h2><p>${esc(err.message)}</p><p>请确认是有效的六位沪深 A 股代码，或稍后再试。</p></div>`;button.disabled=false;button.textContent='重新分析'}return}
 if(e.target.id==='calculatorForm'){const d=Object.fromEntries(new FormData(e.target)),input={name:String(d.name||''),buyPrice:Number(d.buyPrice),qty:Number(d.qty),sellPrice:Number(d.sellPrice),stopPrice:Number(d.stopPrice)||0,capital:Number(d.capital)||0,targetProfit:Number(d.targetProfit)||0};const fees={commissionRatePer10000:Number(d.commissionRatePer10000),minimumCommission:Number(d.minimumCommission),stampDutyRatePer10000:Number(d.stampDutyRatePer10000),transferFeeRatePer10000:Number(d.transferFeeRatePer10000)};if(!(input.buyPrice>0&&input.sellPrice>0&&Number.isInteger(input.qty)&&input.qty>0))return toast('请填写有效的买价、卖价和整数股数');if(Object.values(fees).some(v=>!Number.isFinite(v)||v<0))return toast('请检查交易费率');state.feeSettings=fees;store.set('feeSettings',fees);state.calculatorResult=calculateTrade(input,fees);calculator();toast('已按个人费率计算');return}
 if(e.target.id==='modalForm'){const d=Object.fromEntries(new FormData(e.target));if(d.type==='portfolio'){state.portfolio.push({symbol:d.symbol.toUpperCase(),name:d.name,buy:+d.buy,qty:+d.qty,cycle:d.cycle,riskPreference:d.riskPreference,date:d.date,thesis:d.thesis});store.set('portfolio',state.portfolio);$('#modal').remove();portfolio()}else{state.theses.push({symbol:d.symbol.toUpperCase(),name:d.name,cycle:d.cycle,created:new Date().toISOString().slice(0,10),reason:d.reason,risk:d.risk});store.set('theses',state.theses);$('#modal').remove();theses()}toast('已保存')}
 if(e.target.id==='userForm'){const d=Object.fromEntries(new FormData(e.target));try{await api('/api/admin/users',{method:'POST',body:JSON.stringify(d)});$('#modal').remove();toast('普通用户已创建');adminPage()}catch(err){toast(err.message)}}
 if(e.target.id==='announcementForm'){const d=Object.fromEntries(new FormData(e.target));try{await api('/api/admin/announcements',{method:'POST',body:JSON.stringify(d)});$('#modal').remove();toast('通知已发布');adminPage()}catch(err){toast(err.message)}}
});
async function logout(){await api('/api/logout',{method:'POST'}).catch(()=>{});location.reload()}
$('#logoutBtn').onclick=logout;$('#menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
setInterval(()=>$('#clock').textContent=new Date().toLocaleString('zh-CN',{hour:'2-digit',minute:'2-digit',month:'short',day:'numeric'}),1000);
let presenceTimer=null;function startPresence(){clearInterval(presenceTimer);const ping=()=>api('/api/presence',{method:'POST'}).catch(err=>{if(/登录已失效/.test(err.message))location.reload()});ping();presenceTimer=setInterval(ping,60000)}
(async()=>{try{const s=await api('/api/session');if(s.authenticated){currentUser=s.user;loadUserState();await loadCloudState();$('#login').classList.add('hidden');$('#shell').classList.remove('hidden');navRender();render();startPresence();showUnreadAnnouncements();monitorAndShowAlerts()}}catch(error){$('#loginError').textContent=error.message||'服务暂不可用，登录状态待核验'}})();
