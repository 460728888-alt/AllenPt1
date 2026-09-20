import test from 'node:test';
import assert from 'node:assert/strict';
import {committeeDecision} from './forecast-client.js';

test('committee only confirms when independent views agree',()=>{
  assert.equal(committeeDecision({outperformProbability:62},{upProbability:64}).status,'双模型偏强共振');
  assert.equal(committeeDecision({outperformProbability:61},{upProbability:39}).status,'模型观点分歧');
  assert.equal(committeeDecision({outperformProbability:51},{upProbability:64}).status,'方向尚未确认');
});

test('missing pretrained model never produces a strong signal',()=>{
  const result=committeeDecision({outperformProbability:70},null);
  assert.equal(result.agreement,false);
  assert.equal(result.status,'预训练模型未连接');
});
