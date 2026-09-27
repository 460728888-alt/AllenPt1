import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeVolumeStructure} from './volume-structure.js';

function rows({breakout=false,breakdown=false}={}){
  const list=[];
  for(let i=0;i<45;i++){
    const close=10+Math.sin(i/2)*.13+(i>25?(i-25)*.004:0);
    list.push({time:i,open:close-.03,high:close+.12,low:close-.12,close,volume:100000-(i%5)*2500});
  }
  const base=list.slice(-21,-1),upper=Math.max(...base.map(x=>x.high)),lower=Math.min(...base.map(x=>x.low));
  if(breakout)list[list.length-1]={...list.at(-1),high:upper*1.02,close:upper*1.01,volume:180000};
  if(breakdown)list[list.length-1]={...list.at(-1),low:lower*.97,close:lower*.98,volume:160000};
  return list;
}

test('detects a volume-confirmed breakout',()=>{
  const result=analyzeVolumeStructure(rows({breakout:true}));
  assert.equal(result.stage,'向上突破待确认');
  assert.ok(result.volume.ratio>=1.5);
  assert.ok(result.prices.confirm>result.range.upper);
});

test('detects a volume-confirmed breakdown',()=>{
  const result=analyzeVolumeStructure(rows({breakdown:true}));
  assert.equal(result.stage,'结构失效');
  assert.equal(result.action,'暂停考虑');
});

test('returns explainable range and risk levels',()=>{
  const result=analyzeVolumeStructure(rows());
  assert.ok(result.range.lower<result.range.upper);
  assert.ok(result.prices.target1>result.range.upper);
  assert.match(result.confirmation,/1.5倍/);
});
