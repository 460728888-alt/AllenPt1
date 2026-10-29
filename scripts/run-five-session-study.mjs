import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadMarketCalendar} from '../market-calendar.js';
import {parseHistory,runRuleStudy} from '../historical-rule-study.js';
if(process.env.DATABASE_URL)throw Error('No production database configuration is allowed');
const root=new URL('..',import.meta.url),protocol=JSON.parse(fs.readFileSync(new URL('research/five-session-protocol.json',root),'utf8'));
const directory=path.resolve('test-results/five-session-study');
fs.mkdirSync(directory,{recursive:true});
if(fs.existsSync(path.join(directory,'report.json')))throw Error('Refusing to replace an existing research report');
const calendar=loadMarketCalendar();
if(!calendar)throw Error('Reviewed exchange calendar unavailable');
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fetchedAt=new Date().toISOString(),sourceCommit=process.env.GITHUB_SHA||null;
const requests=[...protocol.universe.map(x=>x.symbol),protocol.benchmark];
const period1=Math.floor(Date.parse(protocol.requestFrom+'T00:00:00+08:00')/1000);
const period2=Math.floor((Date.parse(protocol.requestThrough+'T00:00:00+08:00')+86400000)/1000);
const dataset=[],downloads=[];
let next=0;
async function worker(){
 while(next<requests.length){
  const symbol=requests[next++];let success=false,lastError;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?period1='+period1+'&period2='+period2+'&interval=1d&events=div%2Csplits';
   try{
    const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0 AllenResearch/2.1','Accept':'application/json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('HTTP '+response.status);
    const raw=await response.text(),body=JSON.parse(raw),result=body.chart?.result?.[0];
    if(!result)throw Error(body.chart?.error?.description||'Empty chart result');
    const parsed=parseHistory(result,symbol,protocol);
    if(!parsed.rows.length)throw Error('No historical rows');
    dataset.push(parsed);
    const item={symbol,state:'received',host,requestedFrom:protocol.requestFrom,requestedThrough:protocol.requestThrough,
     downloadedAt:new Date().toISOString(),sourceSha256:digest(raw),sanitizedDataSha256:digest(parsed),
     rows:parsed.rows.length,dataFrom:parsed.rows[0].date,dataThrough:parsed.rows.at(-1).date};
    downloads.push(item);console.log('DATA_SOURCE '+symbol+' received '+parsed.rows.length+' rows');
    success=true;break;
   }catch(error){lastError=String(error.message||error).slice(0,240);await new Promise(r=>setTimeout(r,700))}
  }
  if(!success){downloads.push({symbol,state:'failed',downloadedAt:new Date().toISOString(),reason:lastError});console.log('DATA_SOURCE '+symbol+' failed: '+lastError)}
 }
}
console.log('FROZEN_PROTOCOL '+digest(protocol)+' sourceCommit='+sourceCommit);
console.log('REQUEST_WINDOW '+protocol.requestFrom+' through '+protocol.requestThrough+'; sealed test not requested');
await Promise.all([worker(),worker()]);
dataset.sort((a,b)=>a.symbol.localeCompare(b.symbol));downloads.sort((a,b)=>a.symbol.localeCompare(b.symbol));
fs.writeFileSync(path.join(directory,'dataset.json'),JSON.stringify({protocolId:protocol.id,downloadedAt:fetchedAt,series:dataset},null,2),{flag:'wx'});
const report=runRuleStudy({protocol,calendar,series:dataset,downloads,reconstructedAt:new Date().toISOString(),sourceCommit});
report.datasetSha256=digest(dataset);report.protocolFrozenBeforeDownloadAt=fetchedAt;
fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});
const summary={...report,ledger:undefined,groups:report.groups.map(({daily,...group})=>group)};
const pct=value=>typeof value==='number'?(value*100).toFixed(2)+'%':'未核验';
const names={all_readable:'固定样本全部可读股票日',simple_trend:'简单均线趋势对照',legacy_observation:'原量价观察条件',
 legacy_with_prior_trend:'原观察＋先前趋势对照',price_trigger_only:'仅价格量能触发对照'};
const markdown=[
 '# 五交易日价格反应研究（事后重建）','',
 '数据来自真实提供方历史日线，不是演示数据；这是探索性价格研究，不是当时预测、实际成交或最高准确率证明。','',
 '状态：'+report.status,'',
 '固定请求股票 '+report.coverage.requestedStocks+'，取得 '+report.coverage.receivedStocks+'，失败 '+report.coverage.failedStocks+'；有效价格标签 '+report.coverage.validPriceLabels+'。','',
 '|固定研究组|信号股票日|有效价格标签|不同日期|历史上涨比例|日期等权均价变化|相对同日固定样本|',
 '|---|---:|---:|---:|---:|---:|---:|',
 ...report.groups.map(g=>'|'+names[g.id]+'|'+g.signalStockDays+'|'+g.labelledStockDays+'|'+g.distinctDates+'|'+pct(g.grossPositivePriceFraction)+'|'+pct(g.dailyEqualWeightMeanPriceReturn)+'|'+pct(g.dailyEqualWeightMeanSampleExcess)+'|'),
 '', '上涨比例不是模型准确率或交易胜率；多日信号重叠，详见JSON中的按日期分块区间、季度表现、覆盖及排除记录。','',
 '原观察条件忽略不兼容的资格门槛，仅研究结构观察；正式资格未判定，T2未启用。不会挑选胜者或自动改线上规则。','',
 ...report.limitations.map(x=>'- '+x),'',
 '代码：'+sourceCommit,'数据SHA256：'+report.datasetSha256,'协议SHA256：'+report.protocolSha256
].join('\n');
fs.writeFileSync(path.join(directory,'REPORT.md'),markdown,{flag:'wx'});
console.log('FIVE_DAY_STUDY_JSON='+JSON.stringify(summary));
console.log(markdown);
if(!report.coverage.receivedStocks||!report.coverage.validPriceLabels)process.exitCode=2;
