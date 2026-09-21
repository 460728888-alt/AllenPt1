import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBundleStatus, modelStatus, rankingFeatures, rankIdeas, RANKING_FEATURES } from './ranking-model.js';

test('ranking follows the audited manifest and fails closed when inactive', () => {
  const status = modelStatus();
  assert.match(status.engine, /LightGBM/);
  const ranked = rankIdeas([{symbol:'000001.SZ'},{symbol:'000002.SZ'}],20);
  if (status.active && status.activeHorizons.includes(20)) {
    assert.equal(ranked.items.every(item => item.modelRanking?.days === 20), true);
    assert.equal(ranked.items.every(item => Number.isFinite(item.modelRanking?.probability)), true);
  } else {
    assert.equal(ranked.items.every(item => item.modelRanking === null), true);
  }
});

test('approved horizons activate independently when market data is fresh', () => {
  const bundle={dataThrough:'2026-09-20',horizons:{
    5:{model:{},metrics:{approved:false}},20:{model:{},metrics:{approved:true}},60:{model:{},metrics:{approved:false}}
  }};
  const status=evaluateBundleStatus(bundle,new Date('2026-09-21T00:00:00Z'));
  assert.deepEqual(status.approvedHorizons,[20]);
  assert.deepEqual(status.activeHorizons,[20]);
  assert.equal(status.active,true);
});

test('freshness gate blocks even an approved horizon', () => {
  const bundle={dataThrough:'2020-07-03',horizons:{20:{model:{},metrics:{approved:true}}}};
  const status=evaluateBundleStatus(bundle,new Date('2026-09-21T00:00:00Z'));
  assert.equal(status.stale,true);
  assert.deepEqual(status.activeHorizons,[]);
  assert.equal(status.active,false);
});

test('ranking feature extraction is finite and uses evidence direction', () => {
  const history = Array.from({length:70},(_,index)=>({close:10+index*.05,volume:1000+index*10}));
  const features = rankingFeatures({price:13.45,history,finance:{revenueGrowth:12,profitGrowth:18,netMargin:9,debtRatio:35},evidence:[{negative:false,bodyRead:true,eventDates:[{inWindow:true}]},{negative:true,bodyRead:true,eventDates:[]}]});
  assert.deepEqual(Object.keys(features), RANKING_FEATURES);
  assert.equal(Object.values(features).every(Number.isFinite), true);
  assert.equal(features.timedEventCount, 1);
  assert.equal(features.negativeEvidenceCount, 1);
  assert.notEqual(features.volumeRatio5To20, 1);
  assert.equal(features.return1 > 0, true);
  assert.equal(features.rsi14 >= 0 && features.rsi14 <= 100, true);
});
