import test from 'node:test';
import assert from 'node:assert/strict';
import { modelStatus, rankingFeatures, rankIdeas, RANKING_FEATURES } from './ranking-model.js';

test('untrained manifest fails closed instead of inventing model scores', () => {
  const status = modelStatus();
  assert.equal(status.engine, 'LightGBM LambdaRank');
  assert.equal(status.active, false);
  const ranked = rankIdeas([{symbol:'000001.SZ'},{symbol:'000002.SZ'}],20);
  assert.equal(ranked.items.every(item => item.modelRanking === null), true);
});

test('ranking feature extraction is finite and uses evidence direction', () => {
  const history = Array.from({length:70},(_,index)=>({close:10+index*.05,volume:1000+index*10}));
  const features = rankingFeatures({price:13.45,history,finance:{revenueGrowth:12,profitGrowth:18,netMargin:9,debtRatio:35},evidence:[{negative:false,bodyRead:true,eventDates:[{inWindow:true}]},{negative:true,bodyRead:true,eventDates:[]}]});
  assert.deepEqual(Object.keys(features), RANKING_FEATURES);
  assert.equal(Object.values(features).every(Number.isFinite), true);
  assert.equal(features.timedEventCount, 1);
  assert.equal(features.negativeEvidenceCount, 1);
});
