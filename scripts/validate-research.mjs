import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {evaluateResearch,protocolHash} from '../research-validation.js';
import {validationFixture} from '../tests/fixtures/validation.mjs';
const args=process.argv.slice(2),take=flag=>{const i=args.indexOf(flag);return i<0?null:args[i+1]};
const demo=args.includes('--demo'),inputPath=take('--input'),output=take('--output');
if(!demo&&!inputPath)throw Error('Provide --input dataset.json --output report.json, or --demo. No network/database is used.');
if(!output)throw Error('--output is required; no in-place input modification');
if(inputPath&&path.resolve(inputPath)===path.resolve(output))
 throw Error('Output must not overwrite the input');
const raw=demo?JSON.stringify(validationFixture()):fs.readFileSync(inputPath,'utf8');
if(Buffer.byteLength(raw)>32*1024*1024)throw Error('Input exceeds the 32 MiB pilot limit; use an explicitly documented smaller audit sample');
const input=JSON.parse(raw),partition=args.includes('--final-test')?'test':'validation';
const report=evaluateResearch(input,{partition,allowFinalTest:args.includes('--final-test'),frozenProtocolHash:take('--frozen-protocol-sha256'),frozenDatasetHash:take('--frozen-dataset-sha256')});
report.datasetSha256=crypto.createHash('sha256').update(raw).digest('hex');
report.sourceCommit=process.env.GITHUB_SHA||null;
report.generatedAt=new Date().toISOString();
report.readiness={liveProbabilitiesEnabled:false,modelTrainingPerformed:false,finalTestRequiresFrozenProtocol:true,
 missing:['真实历史股票范围及退市信息','可核验的当时预测、模型和特征处理版本','足够留出样本与不同市场时期','分钟级顺序和可成交证据','资金/仓位/重叠持仓与组合回撤验证']};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:'wx'});
console.log(JSON.stringify({status:report.status,dataKind:report.dataKind,partition,counts:report.counts,approved:false,
 protocolHash:protocolHash(input.protocol),report:output,warning:demo?'SYNTHETIC FRAMEWORK TEST ONLY; NOT REAL RETURNS':'DESCRIPTIVE AUDIT ONLY; NO AUTOMATIC MODEL APPROVAL'}));
