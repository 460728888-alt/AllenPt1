#!/usr/bin/env python3
"""Train leakage-aware LightGBM cross-sectional rankers.

Input is a CSV/Parquet table with one row per (date, symbol). It must contain
the feature columns below and future_excess_5/20/60 labels calculated with
prices strictly after that row. Rows are split by date, never randomly.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from datetime import datetime, timezone

import lightgbm as lgb
import numpy as np
import pandas as pd

FEATURES = [
    "return5", "return20", "return60", "maGap5To20", "maGap20To60",
    "volatility20", "volumeRatio5To20", "distanceToHigh20", "distanceToLow20",
    "revenueGrowth", "profitGrowth", "netMargin", "debtRatio", "timedEventCount",
    "positiveEvidenceCount", "negativeEvidenceCount", "bodyEvidenceCount",
]
HORIZONS = (5, 20, 60)


def relevance(values: pd.Series) -> pd.Series:
    """Map same-day future excess returns to 0..4 relevance without look-ahead across dates."""
    if values.nunique(dropna=True) < 5:
        return values.rank(method="average", pct=True).mul(5).clip(upper=4.999).astype(int)
    return pd.qcut(values.rank(method="first"), 5, labels=False).astype(int)


def ndcg_at_k(labels: np.ndarray, scores: np.ndarray, groups: np.ndarray, k: int = 20) -> float:
    results, start = [], 0
    for size in groups:
        y, s = labels[start:start + size], scores[start:start + size]
        start += size
        order = np.argsort(-s)[:k]
        ideal = np.argsort(-y)[:k]
        weights = 1 / np.log2(np.arange(2, len(order) + 2))
        dcg = np.sum((2 ** y[order] - 1) * weights)
        idcg = np.sum((2 ** y[ideal] - 1) * weights)
        if idcg > 0:
            results.append(dcg / idcg)
    return float(np.mean(results)) if results else 0.0


def score_bins(raw: np.ndarray, returns: np.ndarray) -> list[dict]:
    frame = pd.DataFrame({"score": raw, "ret": returns}).dropna()
    if len(frame) < 100:
        return []
    frame["bin"] = pd.qcut(frame["score"].rank(method="first"), 10, labels=False)
    bins = []
    for _, group in frame.groupby("bin", sort=True):
        bins.append({
            "min": float(group.score.min()), "max": float(group.score.max()),
            "mid": float(group.score.median()),
            "outperformRate": round(float((group.ret > 0).mean() * 100), 1),
            "samples": int(len(group)),
        })
    return bins


def load_frame(source: Path) -> pd.DataFrame:
    frame = pd.read_parquet(source) if source.suffix.lower() in {".parquet", ".pq"} else pd.read_csv(source)
    required = {"date", "symbol", *FEATURES, *(f"future_excess_{h}" for h in HORIZONS)}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise SystemExit("missing columns: " + ", ".join(missing))
    frame["date"] = pd.to_datetime(frame.date, errors="coerce")
    frame = frame.dropna(subset=["date", "symbol"]).sort_values(["date", "symbol"])
    frame[FEATURES] = frame[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0)
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models"))
    parser.add_argument("--min-stocks", type=int, default=80)
    args = parser.parse_args()
    frame = load_frame(args.dataset)
    counts = frame.groupby("date").symbol.transform("count")
    frame = frame[counts >= args.min_stocks].copy()
    dates = np.array(sorted(frame.date.unique()))
    if len(dates) < 300:
        raise SystemExit("need at least 300 distinct trading dates")
    train_end, valid_end = dates[int(len(dates) * .70)], dates[int(len(dates) * .85)]
    train = frame[frame.date < train_end].copy()
    valid = frame[(frame.date >= train_end) & (frame.date < valid_end)].copy()
    test = frame[frame.date >= valid_end].copy()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": 1, "engine": "LightGBM LambdaRank",
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M"),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "dataThrough": str(frame.date.max().date()), "universeSize": int(frame.symbol.nunique()),
        "trainingRows": int(len(train)), "features": FEATURES, "horizons": {},
        "split": {"trainBefore": str(pd.Timestamp(train_end).date()), "validationBefore": str(pd.Timestamp(valid_end).date())},
    }
    all_approved = True
    for horizon in HORIZONS:
        label = f"future_excess_{horizon}"
        tr = train.dropna(subset=[label]).copy()
        va = valid.dropna(subset=[label]).copy()
        te = test.dropna(subset=[label]).copy()
        tr["relevance"] = tr.groupby("date")[label].transform(relevance)
        va["relevance"] = va.groupby("date")[label].transform(relevance)
        te["relevance"] = te.groupby("date")[label].transform(relevance)
        train_group = tr.groupby("date", sort=True).size().to_numpy()
        valid_group = va.groupby("date", sort=True).size().to_numpy()
        model = lgb.LGBMRanker(
            objective="lambdarank", metric="ndcg", n_estimators=800, learning_rate=.025,
            num_leaves=31, max_depth=-1, min_child_samples=100, subsample=.8,
            colsample_bytree=.8, reg_alpha=.15, reg_lambda=.8, random_state=20260920,
        )
        model.fit(
            tr[FEATURES], tr.relevance, group=train_group,
            eval_set=[(va[FEATURES], va.relevance)], eval_group=[valid_group],
            eval_at=[10, 20], callbacks=[lgb.early_stopping(80, verbose=False)],
        )
        raw = model.predict(te[FEATURES], num_iteration=model.best_iteration_)
        test_groups = te.groupby("date", sort=True).size().to_numpy()
        ndcg20 = ndcg_at_k(te.relevance.to_numpy(), raw, test_groups, 20)
        # Use true returns for economically meaningful time-out metrics.
        scored = te.assign(raw=raw)
        daily_top = scored.groupby("date", group_keys=False).apply(lambda x: x.nlargest(max(1, int(len(x) * .1)), "raw"), include_groups=False)
        top_excess = float(daily_top[label].mean()) if len(daily_top) else 0.0
        top_hit = float((daily_top[label] > 0).mean() * 100) if len(daily_top) else 0.0
        approved = len(te) >= 10000 and top_excess > 0 and top_hit >= 52
        all_approved = all_approved and approved
        filename = f"lambdarank-{horizon}d.json"
        (args.output / filename).write_text(json.dumps(model.booster_.dump_model(), ensure_ascii=False), encoding="utf-8")
        manifest["horizons"][str(horizon)] = {
            "file": filename, "bestIteration": int(model.best_iteration_),
            "calibration": score_bins(raw, te[label].to_numpy()),
            "metrics": {"testRows": int(len(te)), "ndcgAt20": round(ndcg20, 4), "topDecileMeanExcess": round(top_excess, 4), "topDecileHitRate": round(top_hit, 1), "approved": approved},
        }
    manifest["validation"] = {"approved": all_approved, "reason": "全部5/20/60日模型须在时间外测试集达到最低样本、正超额收益及52%前十分位胜率"}
    (args.output / "model-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
