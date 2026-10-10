import test from 'node:test';
import assert from 'node:assert/strict';
import {committeeDecision} from './forecast-client.js';

test('unverified and different probability targets never produce agreement',()=>{
 for(const [a,b] of [[62,64],[61,39],[51,64],[null,64],['',70]]) {
  const r=committeeDecision({outperformProbability:a},{upProbability:b});
  assert.equal(r.agreement,false);assert.equal(r.ruleProbability,null);assert.equal(r.modelProbability,null);
 }
});

test('missing pretrained model never produces a strong signal',()=>{
  const result=committeeDecision({outperformProbability:70},null);
  assert.equal(result.agreement,false);
  assert.equal(result.status,'预训练模型未连接');
});
