import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function setup(){
 const nodes=new Map();
 const context=vm.createContext({console,Date,Number,Math,JSON,Map,Set,Promise,Object,String,Array,encodeURIComponent,
 setInterval:()=>0,clearInterval:()=>{},setTimeout,clearTimeout,
 localStorage:{getItem:()=>null,setItem:()=>{}},location:{reload:()=>{}},
 document:{addEventListener:()=>{},querySelector:s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',classList:{add(){},remove(){},toggle(){}},insertAdjacentHTML(_,html){this.innerHTML=html+this.innerHTML}});return nodes.get(s)}},
 fetch:async()=>({ok:true,json:async()=>({authenticated:false})})});
 vm.runInContext(source,context);
 return {context,nodes,run:code=>vm.runInContext(code,context)};
}
test('radar UI preserves chosen window and filters',async()=>{
 const {run,nodes}=setup();run("currentUser={username:'one'};state.page='aiScreen';state.aiScreenCriteria={days:90,risk:'高',announcementLimit:3000,maxRunup:12};api=async url=>url.includes('history')?{reports:[]}:{jobId:null}");
 await run('aiScreenPage()');const html=nodes.get('#content').innerHTML;
 assert.match(html,/value="3000" selected/);assert.match(html,/value="90" selected/);assert.match(html,/option selected>高/);assert.match(html,/value="12"/);
 assert.match(html,/不再随机抽20只/);
});
test('new user clears original report and journal state',()=>{
 const {run}=setup();run("state.aiScreen={secret:1};state.researchJournal=[{secret:1}];currentUser={username:'two'};loadUserState()");
 assert.equal(run('state.aiScreen'),null);assert.equal(run('state.researchJournal.length'),0);
});
test('manual investment reasons are escaped',async()=>{
 const {run,nodes}=setup();run("currentUser={username:'one'};state.page='theses';state.theses=[{name:'<img src=x>',reason:'<script>alert(1)</script>',risk:'<b>risk</b>'}];api=async()=>({items:[],durable:false})");
 await run('theses()');const html=nodes.get('#content').innerHTML;
 assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
});
test('opportunity calendar excludes missing body, negative evidence, past dates and duplicates',()=>{
 const {run}=setup();run(`const evidence={bodyRead:true,title:'计划发布',link:'https://example.com',eventDates:[{date:'2026-09-20',passage:'计划发布'},{date:'2026-09-01'},{date:'2026-12-01'}]};const ideas=[{symbol:'001',name:'甲',evidence:[evidence,evidence,{...evidence,negative:true},{...evidence,bodyRead:false}]}]`);
 assert.equal(run("opportunityDates(ideas,'2026-09-13',30).length"),1);
});
test('changes prioritize invalidation and never equate price movement with fulfillment',()=>{
 const {run}=setup();run(`const items=[{idea:{name:'甲'},status:'逻辑失效',window:{end:'2026-09-01'},notes:[{at:'2026-09-12',status:'逻辑失效',note:'取消'}],checks:[{at:'2026-09-13',changeFromBaseline:10}]}]`);
 assert.equal(run("allenChanges(items,[],'2026-09-13')[0].title"),'我的判断更新：逻辑失效');
 assert.match(run("allenChanges(items,[],'2026-09-13')[1].detail"),/不能证明/);
});
test('scorecard retains failure and unfinished records and has no made-up success rate',()=>{
 const {run}=setup();const html=run("allenScorecard(['逻辑失效','完成复盘','跟踪中'].map((status,i)=>({idea:{name:'股票'+i,rationale:'假设'},status,window:{end:'2026-01-01'},checks:[]})))");
 assert.match(html,/股票0/);assert.match(html,/股票1/);assert.match(html,/股票2/);assert.match(html,/尚未形成经验证/);
});
test('personal scenario calculates both-side fees and leaves unknown target unavailable',()=>{
 const {run}=setup();run("state.portfolio=[{symbol:'001',buy:10,qty:100}];state.feeSettings={commissionRatePer10000:0,minimumCommission:5,stampDutyRatePer10000:0,transferFeeRatePer10000:0}");
 const html=run("costView({symbol:'001',price:11,tradePlan:{}})");assert.match(html,/90\.00/);assert.match(html,/暂无/);
});
test('home renders new focus sections with an empty account',async()=>{
 const {run,nodes}=setup();run("document.body={classList:{add(){}}};currentUser={username:'one'};state.page='dashboard';state.watch=[];state.portfolio=[];api=async()=>({items:[],changes:[]})");
 await run('dashboard()');const html=nodes.get('#content').innerHTML;
 assert.match(html,/今天最值得复核的3条变化/);assert.match(html,/机会时间地图/);assert.match(html,/我的成本视角/);assert.match(html,/暂无已记录变化/);
});
