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
