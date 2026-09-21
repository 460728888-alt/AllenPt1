import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(root, 'models', 'model-manifest.json');
const supportedHorizons = [5, 20, 60];
const cache = { loadedAt:0, modifiedAt:0, bundle:null, error:null };

export const RANKING_FEATURES = [
  'return5','return20','return60','maGap5To20','maGap20To60','volatility20',
  'volumeRatio5To20','distanceToHigh20','distanceToLow20','revenueGrowth',
  'profitGrowth','netMargin','debtRatio','timedEventCount','positiveEvidenceCount',
  'negativeEvidenceCount','bodyEvidenceCount'
];

const numberOr = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const pct = (from, to) => Number.isFinite(from) && Number.isFinite(to) && from !== 0 ? (to / from - 1) * 100 : 0;
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const deviation = values => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map(value => (value - mean) ** 2)));
};

export function rankingFeatures(idea = {}) {
  const history = Array.isArray(idea.history) ? idea.history.filter(row => Number.isFinite(row?.close) && row.close > 0) : [];
  const closes = history.map(row => Number(row.close));
  const volumes = history.map(row => numberOr(row.volume, 0));
  const current = numberOr(idea.price, closes.at(-1) || 0);
  const valueAgo = days => closes.length > days ? closes.at(-1 - days) : current;
  const meanClose = days => average(closes.slice(-days)) || current;
  const ma5 = numberOr(idea.technical?.ma5, meanClose(5));
  const ma20 = numberOr(idea.technical?.ma20, meanClose(20));
  const ma60 = numberOr(idea.technical?.ma60, meanClose(60));
  const returns = closes.slice(-21).slice(1).map((close, index) => pct(closes.slice(-21)[index], close));
  const volume5 = average(volumes.slice(-5));
  const volume20 = average(volumes.slice(-20));
  const high20 = numberOr(idea.technical?.high20, Math.max(...closes.slice(-20), current));
  const low20 = numberOr(idea.technical?.low20, Math.min(...closes.slice(-20), current));
  const evidence = Array.isArray(idea.evidence) ? idea.evidence : [];
  const finance = idea.finance || {};
  return {
    return5:pct(valueAgo(5), current), return20:pct(valueAgo(20), current), return60:pct(valueAgo(60), current),
    maGap5To20:pct(ma20, ma5), maGap20To60:pct(ma60, ma20),
    volatility20:numberOr(idea.technical?.volatility20, deviation(returns)),
    volumeRatio5To20:volume20 > 0 ? volume5 / volume20 : 1,
    distanceToHigh20:pct(high20, current), distanceToLow20:pct(low20, current),
    revenueGrowth:numberOr(finance.revenueGrowth), profitGrowth:numberOr(finance.profitGrowth),
    netMargin:numberOr(finance.netMargin), debtRatio:numberOr(finance.debtRatio, 50),
    timedEventCount:evidence.reduce((sum, item) => sum + (item.eventDates || []).filter(date => date.inWindow).length, 0),
    positiveEvidenceCount:evidence.filter(item => !item.negative).length,
    negativeEvidenceCount:evidence.filter(item => item.negative).length,
    bodyEvidenceCount:evidence.filter(item => item.bodyRead).length
  };
}

function readBundle() {
  const now = Date.now();
  if (now - cache.loadedAt < 60_000) return cache;
  cache.loadedAt = now;
  try {
    const stat = fs.statSync(manifestPath);
    if (cache.bundle && cache.modifiedAt === stat.mtimeMs) return cache;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (![1,2].includes(manifest.schema)) throw new Error('模型清单版本不兼容');
    const horizons = {};
    for (const days of supportedHorizons) {
      const entry = manifest.horizons?.[String(days)];
      if (!entry?.file) continue;
      const full = path.join(root, 'models', path.basename(entry.file));
      horizons[days] = { ...entry, model:JSON.parse(fs.readFileSync(full, 'utf8')) };
    }
    cache.modifiedAt = stat.mtimeMs;
    cache.bundle = { ...manifest, horizons };
    cache.error = null;
  } catch (error) {
    cache.bundle = null;
    cache.error = error.code === 'ENOENT' ? '尚未生成训练模型' : error.message;
  }
  return cache;
}

function treeValue(node, vector) {
  if (Object.hasOwn(node, 'leaf_value')) return numberOr(node.leaf_value);
  const value = vector[node.split_feature];
  const missing = value === null || value === undefined || Number.isNaN(value);
  const goLeft = missing ? Boolean(node.default_left) : Number(value) <= Number(node.threshold);
  return treeValue(goLeft ? node.left_child : node.right_child, vector);
}

function rawPrediction(model, features, featureOrder) {
  const order = featureOrder?.length ? featureOrder : model.feature_names;
  const vector = order.map(name => numberOr(features[name]));
  return (model.tree_info || []).reduce((sum, tree) => sum + treeValue(tree.tree_structure, vector), numberOr(model.average_output));
}

function calibratedProbability(raw, calibration = []) {
  if (!Array.isArray(calibration) || !calibration.length) return null;
  const bin = calibration.find(item => raw >= item.min && raw <= item.max)
    || calibration.reduce((best, item) => Math.abs(raw - item.mid) < Math.abs(raw - best.mid) ? item : best, calibration[0]);
  return Number.isFinite(Number(bin?.outperformRate)) ? Number(bin.outperformRate) : null;
}

function freshness(dataThrough, now = new Date(), maxLagDays = Number(process.env.MODEL_MAX_DATA_LAG_DAYS || 14)) {
  const timestamp = Date.parse(`${dataThrough || ''}T23:59:59Z`);
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000)) : null;
  return {ageDays,maxLagDays,fresh:Number.isFinite(ageDays) && ageDays <= maxLagDays};
}

export function evaluateBundleStatus(bundle, now = new Date()) {
  const fresh = freshness(bundle?.dataThrough, now);
  const horizons = supportedHorizons.map(days => {
    const entry = bundle?.horizons?.[days] || bundle?.horizons?.[String(days)];
    const available = Boolean(entry?.model);
    const approved = Boolean(entry?.metrics?.approved === true);
    return {days,available,approved,active:available && approved && fresh.fresh,metrics:entry?.metrics || null,labelThrough:entry?.labelThrough || null};
  });
  const availableHorizons = horizons.filter(item => item.available).map(item => item.days);
  const approvedHorizons = horizons.filter(item => item.available && item.approved).map(item => item.days);
  const activeHorizons = horizons.filter(item => item.active).map(item => item.days);
  let message = '尚未生成训练模型';
  if (availableHorizons.length) {
    if (!approvedHorizons.length) message = '模型文件存在，但各周期均未通过时间外验证，继续使用证据规则';
    else if (!fresh.fresh) message = `通过验证的周期：${approvedHorizons.join(' / ')}日；但训练数据已滞后${fresh.ageDays ?? '未知'}天，暂不启用`;
    else message = `已启用通过滚动验证的${activeHorizons.join(' / ')}日模型；其他周期继续使用证据规则`;
  }
  return {
    engine:'LightGBM LambdaRank', available:availableHorizons.length > 0,
    validated:approvedHorizons.length > 0, active:activeHorizons.length > 0,
    stale:availableHorizons.length > 0 && !fresh.fresh, dataAgeDays:fresh.ageDays,
    maxDataLagDays:fresh.maxLagDays, availableHorizons, approvedHorizons, activeHorizons,
    horizons, message,
  };
}

export function modelStatus() {
  const loaded = readBundle();
  const bundle = loaded.bundle;
  const evaluated = evaluateBundleStatus(bundle);
  return {
    ...evaluated,
    version:bundle?.version || null, trainedAt:bundle?.trainedAt || null,
    dataThrough:bundle?.dataThrough || null, universeSize:bundle?.universeSize || null,
    trainingRows:bundle?.trainingRows || null, validation:bundle?.validation || null,
    message:loaded.error || evaluated.message
  };
}

export function rankIdeas(ideas = [], days = 20) {
  const loaded = readBundle(), bundle = loaded.bundle, entry = bundle?.horizons?.[days];
  const status = modelStatus();
  const horizonActive = status.horizons.find(item => item.days === Number(days))?.active;
  if (!horizonActive || !entry?.model || ideas.length < 2) return { status, items:ideas.map(idea => ({...idea,modelRanking:null})) };
  const scored = ideas.map(idea => {
    const features = rankingFeatures(idea);
    const raw = rawPrediction(entry.model, features, bundle.features || RANKING_FEATURES);
    return {...idea, modelRanking:{days,rawScore:raw,probability:calibratedProbability(raw, entry.calibration),features}};
  }).sort((a,b) => b.modelRanking.rawScore - a.modelRanking.rawScore);
  const denominator = Math.max(1, scored.length - 1);
  return {status,items:scored.map((item,index) => ({...item,modelRanking:{...item.modelRanking,rank:index+1,percentile:Number(((1-index/denominator)*100).toFixed(1)),candidateCount:scored.length}}))};
}
