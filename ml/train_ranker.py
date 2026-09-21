#!/usr/bin/env python3
"""Train leakage-aware LightGBM cross-sectional rankers.

Validation uses date-only expanding walk-forward folds, estimated round-trip
costs, and independent approval for the 5/20/60 trading-day horizons.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

FEATURES = [
    "return1", "return5", "return10", "return20", "return60", "maGap5To20", "maGap20To60",
    "volatility5", "volatility20", "volatilityRatio5To20", "volumeRatio5To20",
    "volumeRatio5To60", "distanceToHigh20", "distanceToLow20", "distanceToHigh60",
    "distanceToLow60", "rsi14", "macdGap", "momentumAcceleration",
    "revenueGrowth", "profitGrowth", "netMargin", "debtRatio", "timedEventCount",
    "positiveEvidenceCount", "negativeEvidenceCount", "bodyEvidenceCount",
]
HORIZONS = (5, 20, 60)
SEED = 20260920


def relevance(values: pd.Series, cost_pct: float) -> pd.Series:
    """Prioritize net winners, then rank the magnitude of those winners.

    Labels 1..4 are reserved for stocks whose same-date excess return remains
    positive after estimated round-trip costs. Losing observations stay at 0.
    This keeps the learning objective aligned with the deployment approval gate.
    """
    net = values - cost_pct
    result = pd.Series(0, index=values.index, dtype="int64")
    winners = net > 0
    if winners.any():
        winner_rank = net.loc[winners].rank(method="first", pct=True)
        result.loc[winners] = np.ceil(winner_rank * 4).clip(1, 4).astype(int)
    return result


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


def score_bins(raw: np.ndarray, net_returns: np.ndarray) -> list[dict]:
    frame = pd.DataFrame({"score": raw, "ret": net_returns}).dropna()
    if len(frame) < 100:
        return []
    frame["bin"] = pd.qcut(frame["score"].rank(method="first"), 10, labels=False)
    return [{
        "min": float(group.score.min()), "max": float(group.score.max()),
        "mid": float(group.score.median()),
        "outperformRate": round(float((group.ret > 0).mean() * 100), 1),
        "samples": int(len(group)),
    } for _, group in frame.groupby("bin", sort=True)]


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


def prepare(frame: pd.DataFrame, label: str, cost_pct: float) -> pd.DataFrame:
    result = frame.dropna(subset=[label]).copy().sort_values(["date", "symbol"])
    result["relevance"] = result.groupby("date")[label].transform(
        lambda values: relevance(values, cost_pct)
    )
    return result


def make_model(seed: int = SEED) -> lgb.LGBMRanker:
    return lgb.LGBMRanker(
        objective="lambdarank", metric="ndcg", n_estimators=800, learning_rate=.025,
        num_leaves=31, max_depth=-1, min_child_samples=100, subsample=.8,
        colsample_bytree=.8, reg_alpha=.15, reg_lambda=.8, random_state=seed,
        verbosity=-1,
    )


def fit_model(train: pd.DataFrame, valid: pd.DataFrame, seed: int) -> lgb.LGBMRanker:
    model = make_model(seed)
    model.fit(
        train[FEATURES], train.relevance,
        group=train.groupby("date", sort=True).size().to_numpy(),
        eval_set=[(valid[FEATURES], valid.relevance)],
        eval_group=[valid.groupby("date", sort=True).size().to_numpy()],
        eval_at=[10, 20], callbacks=[lgb.early_stopping(80, verbose=False)],
    )
    return model


def fold_boundaries(dates: np.ndarray, folds: int) -> list[tuple]:
    """Return expanding train, validation and non-overlapping test windows."""
    window = max(20, len(dates) // (folds + 7))
    first_train_end = len(dates) - window * (folds + 1)
    if first_train_end < 180:
        raise SystemExit("not enough dates for walk-forward validation")
    result = []
    for index in range(folds):
        train_end = first_train_end + index * window
        valid_end = train_end + window
        test_end = valid_end + window
        result.append((dates[train_end], dates[valid_end], dates[min(test_end, len(dates)) - 1]))
    return result


def evaluate(model: lgb.LGBMRanker, test: pd.DataFrame, label: str, cost_pct: float) -> tuple[dict, pd.DataFrame]:
    raw = model.predict(test[FEATURES], num_iteration=model.best_iteration_)
    groups = test.groupby("date", sort=True).size().to_numpy()
    scored = test.assign(raw=raw)
    top = scored.groupby("date", group_keys=False).apply(
        lambda x: x.nlargest(max(1, int(len(x) * .1)), "raw"), include_groups=False
    )
    gross = float(top[label].mean()) if len(top) else 0.0
    net = top[label] - cost_pct if len(top) else pd.Series(dtype=float)
    metrics = {
        "testRows": int(len(test)), "testDates": int(test.date.nunique()),
        "ndcgAt20": round(ndcg_at_k(test.relevance.to_numpy(), raw, groups, 20), 4),
        "topDecileGrossMeanExcess": round(gross, 4),
        "topDecileNetMeanExcess": round(float(net.mean()) if len(net) else 0.0, 4),
        "topDecileNetHitRate": round(float((net > 0).mean() * 100) if len(net) else 0.0, 1),
    }
    return metrics, scored.assign(net_return=scored[label] - cost_pct)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("models"))
    parser.add_argument("--min-stocks", type=int, default=80)
    parser.add_argument("--walk-forward-folds", type=int, default=3)
    parser.add_argument("--round-trip-cost-bps", type=float, default=30.0)
    parser.add_argument("--min-hit-rate", type=float, default=52.0)
    args = parser.parse_args()
    if not 2 <= args.walk_forward_folds <= 5:
        raise SystemExit("walk-forward-folds must be between 2 and 5")

    frame = load_frame(args.dataset)
    counts = frame.groupby("date").symbol.transform("count")
    frame = frame[counts >= args.min_stocks].copy()
    if frame.date.nunique() < 300:
        raise SystemExit("need at least 300 distinct trading dates")

    cost_pct = args.round_trip_cost_bps / 100.0
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": 2, "engine": "LightGBM LambdaRank",
        "version": datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M"),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "dataThrough": str(frame.date.max().date()),
        "universeSize": int(frame.symbol.nunique()), "trainingRows": int(len(frame)),
        "features": FEATURES, "horizons": {},
        "validation": {
            "mode": "expanding walk-forward", "folds": args.walk_forward_folds,
            "roundTripCostBps": args.round_trip_cost_bps,
            "minimumNetHitRate": args.min_hit_rate,
            "trainingObjective": "cost-aware net-winner ranking",
        },
    }

    approved_horizons = []
    for horizon in HORIZONS:
        label = f"future_excess_{horizon}"
        labelled = prepare(frame, label, cost_pct)
        dates = np.array(sorted(labelled.date.unique()))
        fold_metrics, out_of_sample = [], []
        for fold_index, (train_end, valid_end, test_last) in enumerate(
            fold_boundaries(dates, args.walk_forward_folds), 1
        ):
            train = labelled[labelled.date < train_end]
            valid = labelled[(labelled.date >= train_end) & (labelled.date < valid_end)]
            test = labelled[(labelled.date >= valid_end) & (labelled.date <= test_last)]
            if min(train.date.nunique(), valid.date.nunique(), test.date.nunique()) < 20:
                raise SystemExit(f"horizon {horizon}: fold {fold_index} is too small")
            model = fit_model(train, valid, SEED + horizon * 10 + fold_index)
            metrics, scored = evaluate(model, test, label, cost_pct)
            metrics.update({
                "fold": fold_index,
                "trainThrough": str(pd.Timestamp(train.date.max()).date()),
                "validationThrough": str(pd.Timestamp(valid.date.max()).date()),
                "testThrough": str(pd.Timestamp(test.date.max()).date()),
            })
            fold_metrics.append(metrics)
            out_of_sample.append(scored[["date", "symbol", "raw", label, "net_return", "relevance"]])

        oos = pd.concat(out_of_sample, ignore_index=True).sort_values(["date", "symbol"])
        groups = oos.groupby("date", sort=True).size().to_numpy()
        daily_top = oos.groupby("date", group_keys=False).apply(
            lambda x: x.nlargest(max(1, int(len(x) * .1)), "raw"), include_groups=False
        )
        gross_mean = float(daily_top[label].mean())
        net_returns = daily_top[label] - cost_pct
        net_mean = float(net_returns.mean())
        net_hit = float((net_returns > 0).mean() * 100)
        positive_folds = sum(item["topDecileNetMeanExcess"] > 0 for item in fold_metrics)
        approved = (
            len(oos) >= 10_000 and net_mean > 0 and net_hit >= args.min_hit_rate
            and positive_folds >= (len(fold_metrics) + 1) // 2
        )
        if approved:
            approved_horizons.append(horizon)

        final_split = dates[int(len(dates) * .85)]
        final_train = labelled[labelled.date < final_split]
        final_valid = labelled[labelled.date >= final_split]
        final_model = fit_model(final_train, final_valid, SEED + horizon)
        final_raw = final_model.predict(final_valid[FEATURES], num_iteration=final_model.best_iteration_)
        filename = f"lambdarank-{horizon}d.json"
        (args.output / filename).write_text(
            json.dumps(final_model.booster_.dump_model(), ensure_ascii=False), encoding="utf-8"
        )
        manifest["horizons"][str(horizon)] = {
            "file": filename, "bestIteration": int(final_model.best_iteration_),
            "labelThrough": str(pd.Timestamp(labelled.date.max()).date()),
            # Calibration must use the deployable model's score scale. Approval
            # metrics above still come only from the untouched walk-forward folds.
            "calibration": score_bins(final_raw, (final_valid[label] - cost_pct).to_numpy()),
            "metrics": {
                "testRows": int(len(oos)), "testDates": int(oos.date.nunique()),
                "ndcgAt20": round(ndcg_at_k(oos.relevance.to_numpy(), oos.raw.to_numpy(), groups, 20), 4),
                "topDecileGrossMeanExcess": round(gross_mean, 4),
                "topDecileNetMeanExcess": round(net_mean, 4),
                "topDecileNetHitRate": round(net_hit, 1),
                "topDecileMeanExcess": round(net_mean, 4),
                "topDecileHitRate": round(net_hit, 1),
                "positiveFolds": positive_folds, "approved": approved,
            },
            "walkForward": fold_metrics,
        }

    manifest["validation"].update({
        "approved": bool(approved_horizons),
        "allApproved": len(approved_horizons) == len(HORIZONS),
        "approvedHorizons": approved_horizons,
        "reason": "各周期独立审批；滚动时间外测试扣除交易成本后须有正超额、达到最低胜率且多数折为正",
    })
    (args.output / "model-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
