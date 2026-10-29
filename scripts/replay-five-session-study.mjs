import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {loadMarketCalendar} from '../market-calendar.js';
import {runRuleStudy} from '../historical-rule-study.js';
if(process.env.DATABASE_URL)throw Error('No database configuration is allowed');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expected={sourceCommit:'08899f582a978cf1ebf41d7c0a9e191e0d87249e',
 protocolSha256:'09f7057f8318a5f0b7fb343996c912ecf227705ff2ea659638f40e22a9453f41',
 datasetSha256:'4fb4a2f562aaee8e4537e12f030c4c0e0b9fb1fcfae71a290a81fb795f2eaeae',
 runId:40852067281,artifactId:12887930600};
const input=path.resolve(process.argv[2]||'frozen-study'),files=[];
function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);
 if(entry.isDirectory())walk(file);else if(entry.isFile()&&['dataset.json','report.json'].includes(entry.name))files.push(file);
}}
walk(input);
const one=name=>{const found=files.filter(file=>path.basename(file)===name);if(found.length!==1)throw Error('Exactly one frozen '+name+' required');return found[0]};
const dataText=fs.readFileSync(one('dataset.json'),'utf8'),dataset=JSON.parse(dataText);
const original=JSON.parse(fs.readFileSync(one('report.json'),'utf8'));
const protocol=JSON.parse(fs.readFileSync(new URL('../research/five-session-protocol.json',import.meta.url),'utf8'));
if(original.sourceCommit!==expected.sourceCommit||original.protocolSha256!==expected.protocolSha256||
 hash(protocol)!==expected.protocolSha256||hash(dataset.series)!==expected.datasetSha256||
 original.datasetSha256!==expected.datasetSha256)throw Error('Frozen source/protocol/data fingerprint mismatch');
const calendar=loadMarketCalendar();
if(!calendar)throw Error('Reviewed calendar unavailable');
const report=runRuleStudy({protocol,calendar,series:dataset.series,downloads:original.downloads,
 reconstructedAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA||null});
const identity=rows=>rows.map(({reconstructedAt,...row})=>row);
if(hash(identity(report.ledger))!==hash(identity(original.ledger)))throw Error('Correction changed frozen selection, evidence or outcomes');
const primaryFields=['id','signalStockDays','labelledStockDays','labelMissing','distinctDates','distinctSymbols',
 'grossPositivePriceFraction','dailyEqualWeightMeanPriceReturn','dailyEqualWeightMeanIndexExcess','dailyEqualWeightMeanSampleExcess'];
const metrics=groups=>groups.map(g=>Object.fromEntries(primaryFields.map(key=>[key,g[key]])));
if(hash(metrics(report.groups))!==hash(metrics(original.groups)))throw Error('Correction changed original gross study metrics');
report.datasetSha256=expected.datasetSha256;
report.protocolFrozenBeforeDownloadAt=original.protocolFrozenBeforeDownloadAt;
report.dataOrigin={...expected,downloadedAt:dataset.downloadedAt,noNewDataRequests:true};
report.correction={reason:'统一成本与主统计的日期等权口径，辅助股票日统计单列；明确原触发组含量能条件及历史价格口径未核验',
 sameSelectionEvidenceAndLabels:true,sameGrossMetrics:true,originalReportPreserved:true};
const directory=path.resolve('test-results/five-session-corrected');
fs.mkdirSync(directory,{recursive:true});
for(const [name,content]of [['dataset.json',dataText],['original-report.json',JSON.stringify(original,null,2)],['report.json',JSON.stringify(report,null,2)]])
 fs.writeFileSync(path.join(directory,name),content,{flag:'wx'});
const summary={...report,ledger:undefined,groups:report.groups.map(({daily,...group})=>group)};
const names={all_readable:'固定样本全部可读股票日',simple_trend:'简单均线趋势',
 legacy_observation:'原量价观察',legacy_with_prior_trend:'原观察＋前置趋势',price_trigger_only:'原放量突破触发（含量能）'};
const pct=value=>typeof value==='number'?(value*100).toFixed(2)+'%':'未核验';
const interval=value=>value.low===null?'样本不足':pct(value.low)+' ～ '+pct(value.high);
const lines=['# 五交易日真实历史研究：事后重建，收益优势未证明','',
 '固定32只当前名单A股，2024暖机、2025研究；2026未请求。不是当时预测或可执行组合回测。','',
 '|规则组|信号股票日|有效标签|不同日期|历史价格上涨比例|日期等权价格变化|相对同日固定样本|相对样本的探索性区间|假设往返30基点后（日等权）|',
 '|---|---:|---:|---:|---:|---:|---:|---|---:|',
 ...report.groups.map(g=>'|'+names[g.id]+'|'+g.signalStockDays+'|'+g.labelledStockDays+'|'+g.distinctDates+'|'+
 pct(g.grossPositivePriceFraction)+'|'+pct(g.dailyEqualWeightMeanPriceReturn)+'|'+pct(g.dailyEqualWeightMeanSampleExcess)+'|'+
 interval(g.uncertainty.sampleExcess)+'|'+pct(g.hypotheticalCostScenarios.find(c=>c.roundTripBps===30).dailyEqualWeightMeanAssumedReturn)+'|'),
 '', '上涨比例以有效股票日计；平均价格变化、相对样本、费用情景按日期等权。两种分母不同，不得由上涨比例推导平均收益。','',
 '所有非基线规则相对同日固定样本的探索性区间均跨越零，不能据此证明稳定优势；不挑选胜者、不启用概率或T2。','',
 '原内部ID price_trigger_only 实际含量比1.5条件，不能据此推断量能单独贡献。','',
 '口径复核保留初次报告；只更正成本统计权重及说明。所有信号成员、证据、标签和原毛价格统计逐行核对未变，没有重新下载数据。','',
 ...report.limitations.map(s=>'- '+s),'',
 '初次数据工作流：https://github.com/460728888-alt/AllenPt1/actions/runs/'+expected.runId,
 '当前计算源代码：'+report.sourceCommit,'协议SHA256：'+report.protocolSha256,'数据SHA256：'+report.datasetSha256];
fs.writeFileSync(path.join(directory,'REPORT.md'),lines.join('\n'),{flag:'wx'});
console.log('FIVE_DAY_STUDY_JSON='+JSON.stringify(summary));
console.log(lines.join('\n'));
