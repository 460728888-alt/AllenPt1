import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {demoData} from '../tests/fixtures/workbench.mjs';
import {snapshotHash} from '../research-store.js';
const root=fileURLToPath(new URL('..',import.meta.url));
export function buildWorkbenchPreview(){
  const data=demoData();
  for(const record of data.records){
    record.snapshotHash=snapshotHash(record.original);record.snapshotVerified=true;
    record.generatedAt=record.original.generatedAt;record.strategyVersion='range20-t1-review-1';
    record.calculationVersion='range20-1';record.sourceScanId='DEMO-SCAN';
  }
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const read=name=>fs.readFileSync(path.join(root,name),'utf8');
  const script=code=>'<script>'+code.replace(/<\/script/gi,'<\\/script')+'</script>';
  const bootstrap='const WB_DEMO_DATA='+JSON.stringify(data).replace(/</g,'\\u003c')+';\n'+"\nlet previewScene='observe';\nconst clone=value=>JSON.parse(JSON.stringify(value));\ntry{Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null,setItem:()=>{}},configurable:true})}catch{}\nglobalThis.fetch=async(input,options={})=>{\n  const url=String(input),method=options.method||'GET';\n  const result=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>clone(body)});\n  if(url==='/api/session')return result({authenticated:true,user:{id:1,username:'DEMO',displayName:'演示账号',role:'user'}});\n  if(url==='/api/user-state')return result(method==='GET'?{state:{watch:[],portfolio:[],theses:[]}}:{ok:true});\n  if(['/api/presence','/api/signals/snapshot','/api/monitor'].includes(url))return result({ok:true,changes:[]});\n  if(url==='/api/announcements')return result({announcements:[]});\n  if(url==='/api/alerts')return result({alerts:[]});\n  if(url==='/api/workbench/context')return result(WB_DEMO_DATA.context);\n  if(url==='/api/model/status')return result(WB_DEMO_DATA.model);\n  if(url==='/api/ai/radar-history')return result({reports:WB_DEMO_DATA.reports,durable:false});\n  if(url==='/api/research-history'){\n    const items=['empty','failed','insufficient'].includes(previewScene)?[]:\n      previewScene==='invalid'?WB_DEMO_DATA.history.filter(x=>x.status==='invalidated'):WB_DEMO_DATA.history;\n    return result({items,storage:{state:'demo',durable:false}});\n  }\n  if(url==='/api/volume-screen/latest'){\n    if(previewScene==='failed')return result({error:'演示：全部行情请求失败'},503);\n    const scan=clone(WB_DEMO_DATA.scan);\n    if(previewScene==='empty'){\n      scan.items=[];scan.counts.observations=0;\n      Object.assign(scan.coverage,{returned:12,failed:0,usable:12,coveragePct:100,partial:false,failures:[]});\n    }\n    if(previewScene==='insufficient'){\n      scan.items=[];scan.counts.observations=0;\n      Object.assign(scan.coverage,{returned:12,failed:0,usable:0,coveragePct:0,partial:true,\n        failures:[{symbol:'DEMO',state:'insufficient',code:'missing_volume',message:'演示：成交量缺失，暂停判断'}]});\n    }\n    if(previewScene==='invalid'){scan.items=[];scan.counts.observations=0}\n    return result({result:scan});\n  }\n  const match=url.match(/^\\/api\\/research-history\\/([^/]+)(\\/notes)?$/);\n  if(match){\n    const record=WB_DEMO_DATA.records.find(r=>r.researchId===decodeURIComponent(match[1]));\n    if(!record)return result({error:'演示记录不存在'},404);\n    if(match[2]&&method==='POST'){\n      const body=JSON.parse(options.body);\n      if(!record.events.some(e=>e.requestKey===body.requestKey)){\n        const latest=record.events.at(-1);\n        record.events.push({id:'DEMO-NOTE-'+record.events.length,requestKey:body.requestKey,\n          kind:'note',occurred_at:'2026-10-14T09:00:00Z',data_through:'2026-10-14',\n          payload:{...latest.payload,note:body.note}});\n      }\n      return result({ok:true});\n    }\n    return result(record);\n  }\n  return result({error:'独立演示不连接真实行情或生产服务；此入口请在完整网站使用。'},503);\n};\ndocument.addEventListener('click',event=>{\n  const button=event.target.closest('[data-preview-scene]');\n  if(!button)return;\n  previewScene=button.dataset.previewScene;\n  document.querySelectorAll('[data-preview-scene]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));\n  state.archiveRecord=null;state.wb=null;go('dashboard');\n});\n";
  const bar='<section id="wbDemoBanner"><b>独立预览 · 全部为虚构演示数据</b><span>不连接真实行情，不代表回测或模型成绩；笔记只保存在本次页面内存中。</span><div>'+
    [['observe','有观察'],['empty','暂无观察'],['insufficient','数据不足'],['failed','请求失败'],['invalid','已失效']].map(([id,name])=>'<button data-preview-scene="'+id+'" aria-pressed="'+(id==='observe')+'">'+name+'</button>').join('')+'</div></section>';
  html=html.replace(/<link rel="stylesheet" href="[^"]+">/g,'');
  html=html.replace('</head>','<style>'+read('styles.css')+'\n'+read('workbench.css')+
    '\n#wbDemoBanner{position:relative;z-index:30;background:#fff0cb;color:#6e5324;padding:12px 20px;font:12px sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap}#wbDemoBanner span{font-size:10px}#wbDemoBanner button{padding:7px 10px;margin:3px;border:1px solid #d6bb7e;border-radius:5px;background:#fffaf0;color:#735326;cursor:pointer}#wbDemoBanner button[aria-pressed=true]{background:#7b5c26;color:#fff}</style></head>');
  html=html.replace('<body>','<body>'+bar);
  html=html.replace(/<script src="\/research-workbench\.js[^"]*" defer><\/script>/,()=>script(read('research-workbench.js')));
  html=html.replace(/<script src="\/app\.js[^"]*" defer><\/script>/,()=>script(bootstrap)+script(read('app.js')));
  return html;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  const target=path.join(root,'test-results/Allen-opportunity-preview.html');
  fs.writeFileSync(target,buildWorkbenchPreview());
  console.log('Standalone synthetic preview: '+target);
}
