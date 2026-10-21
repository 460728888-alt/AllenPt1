import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guardForecast,
  sameProbabilityTarget
} from './probability-contract.js';

// 全部为防护逻辑测试夹具，不是真实预测或模型验证成绩。
const fields=[
  ['positiveProbability','up'],
  ['upProbability','up'],
  ['outperformProbability','outperform']
];

function contract(days,target='up') {
  return {
    target,days,
    startRule:'test_start',
    endRule:'test_end',
    feeBasis:'test_gross',
    ...(target==='outperform'?{benchmark:'test_index'}:{}),
    validation:{
      approved:true,
      method:'synthetic_test_only',
      evidenceRef:'synthetic_fixture_not_real_validation',
      sampleSize:100,
      evaluatedThrough:'2020-01-01',
      validUntil:'2099-01-01'
    }
  };
}

function forecast(key,target,days,contractDays=days) {
  return {
    days,
    [key]:60,
    probabilityContracts:{[key]:contract(contractDays,target)}
  };
}

test('20日验证不能放行5日概率',()=>{
  for (const [key,target] of fields) {
    assert.equal(
      guardForecast(forecast(key,target,5,20))[key],null
    );
  }
});

test('5日验证不能放行20日概率',()=>{
  for (const [key,target] of fields) {
    assert.equal(
      guardForecast(forecast(key,target,20,5))[key],null
    );
  }
});

test('匹配周期及目标的测试契约保留数值',()=>{
  for (const days of [5,20,60]) {
    for (const [key,target] of fields) {
      assert.equal(
        guardForecast(forecast(key,target,days))[key],60
      );
    }
  }
});

test('周期缺失或格式无效时不输出概率',()=>{
  for (const days of [undefined,null,'5',0,-5,1.5,NaN,Infinity]) {
    const input=forecast('upProbability','up',days,5);
    assert.equal(guardForecast(input).upProbability,null);
  }
});

test('上涨与跑赢基准的目标不可互换',()=>{
  const input=forecast('upProbability','outperform',5);
  assert.equal(guardForecast(input).upProbability,null);
  const second=forecast('outperformProbability','up',5);
  assert.equal(guardForecast(second).outperformProbability,null);
});

test('过期验证信息不输出概率',()=>{
  const input=forecast('upProbability','up',5);
  input.probabilityContracts.upProbability.validation.validUntil=
    '2000-01-01';
  assert.equal(guardForecast(input).upProbability,null);
});

test('没有验证契约不输出概率',()=>{
  assert.equal(
    guardForecast({days:5,upProbability:90}).upProbability,null
  );
});

test('无效概率不补成零',()=>{
  for (const value of [null,undefined,'',NaN,-1,101]) {
    const input=forecast('upProbability','up',5);
    input.upProbability=value;
    assert.equal(guardForecast(input).upProbability,null);
  }
});

test('有效边界值零与一百不会被当作缺失',()=>{
  for (const value of [0,100]) {
    const input=forecast('upProbability','up',5);
    input.upProbability=value;
    assert.equal(guardForecast(input).upProbability,value);
  }
});

test('被拒绝的概率不保留方向和准确率结论',()=>{
  const input={
    ...forecast('upProbability','up',5,20),
    direction:'偏强',confidence:'较高',validationAccuracy:90
  };
  const result=guardForecast(input);
  assert.equal(result.direction,'未判定');
  assert.equal(result.confidence,'未验证');
  assert.equal(result.validationAccuracy,null);
});

test('不修改传入的原始对象',()=>{
  const input=forecast('upProbability','up',5,20);
  const before=JSON.stringify(input);
  guardForecast(input);
  assert.equal(JSON.stringify(input),before);
});

test('嵌套预测同样检查自身周期',()=>{
  const result=guardForecast({
    days:5,
    foundation:forecast('upProbability','up',5,20)
  });
  assert.equal(result.foundation.upProbability,null);
});

test('比较预测目标时包含周期',()=>{
  assert.equal(
    sameProbabilityTarget(contract(5),contract(20)),false
  );
});
