#!/usr/bin/env python3
"""Research a leakage-aware 20-day LightGBM ensemble.

The ranker estimates relative payoff while the classifier estimates whether a
stock beats the same-date universe median after costs.  Each walk-forward fold
uses an embargo equal to the prediction horizon.  Ensemble weight and daily
coverage are selected on the validation window only, then frozen for that
fold's test window.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from train_ranker import FEATURES, SEED, relevance

HORIZON = 20
LABEL = "future_excess_20"
WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)
COVERAGES = (0.01, 0.03, 0.05, 0.10)


def load_frame(path: Path) -> pd.DataFrame:
    frame = pd.read_parquet(path)
    required = {"date", "symbol", LABEL, *FEATURES}
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise SystemExit("missing columns: " + ", ".join(missing))
    frame["date"] = pd.to_datetime(frame.date, errors="coerce")
    frame = frame.dropna(subset=["date", "symbol", LABEL]).sort_values(["date", "symbol"])
    frame[FEATURES] = frame[FEATURES].replace([np.inf, -np.inf], np.nan).fillna(0)
    return frame


def make_ranker(seed: int) -> lgb.LGBMRanker:
    return lgb.LGBMRanker(
        objective="lambdarank", metric="ndcg", n_estimators=900,
        learning_rate=0.02, num_leaves=31, min_child_samples=120,
        colsample_bytree=0.8, reg_alpha=0.2, reg_lambda=1.0,
        random_state=seed, verbosity=-1,
    )


def make_classifier(seed: int) -> lgb.LGBMClassifier:
    return lgb.LGBMClassifier(
        objective="binary", metric="binary_logloss", n_estimators=700,
        learning_rate=0.025, num_leaves=31, min_child_samples=160,
        colsample_bytree=0.8, reg_alpha=0.2, reg_lambda=1.0,
        random_state=seed, verbosity=-1,
    )


def fit_models(train: pd.DataFrame, valid: pd.DataFrame, cost: float, seed: int):
    ranker = make_ranker(seed)
    ranker.fit(
        train[FEATURES], train.relevance,
        group=train.groupby("date", sort=True).size().to_numpy(),
        eval_set=[(valid[FEATURES], valid.relevance)],
        eval_group=[valid.groupby("date", sort=True).size().to_numpy()],
        eval_at=[10, 20], callbacks=[lgb.early_stopping(80, verbose=False)],
    )
    classifier = make_classifier(seed + 1)
    classifier.fit(
        train[FEATURES], (train[LABEL] - cost > 0).astype("int8"),
        eval_set=[(valid[FEATURES], (valid[LABEL] - cost > 0).astype("int8"))],
        callbacks=[lgb.early_stopping(80, verbose=False)],
    )
    return ranker, classifier


def percentile_by_date(frame: pd.DataFrame, column: str) -> pd.Series:
    return frame.groupby("date")[column].rank(method="average", pct=True)


def score(frame: pd.DataFrame, ranker, classifier) -> pd.DataFrame:
    result = frame[["date", "symbol", LABEL]].copy()
    result["rank_raw"] = ranker.predict(frame[FEATURES], num_iteration=ranker.best_iteration_)
    result["win_probability"] = classifier.predict_proba(
        frame[FEATURES], num_iteration=classifier.best_iteration_
    )[:, 1]
    result["rank_pct"] = percentile_by_date(result, "rank_raw")
    result["win_pct"] = percentile_by_date(result, "win_probability")
    return result


def selected(scored: pd.DataFrame, weight: float, coverage: float) -> pd.DataFrame:
    frame = scored.copy()
    frame["ensemble"] = weight * frame.rank_pct + (1 - weight) * frame.win_pct
    picks = [
        group.nlargest(max(1, int(np.ceil(len(group) * coverage))), "ensemble")
        for _, group in frame.groupby("date", sort=True)
    ]
    return pd.concat(picks, ignore_index=True) if picks else frame.iloc[0:0]


def metrics(scored: pd.DataFrame, weight: float, coverage: float, cost: float) -> dict:
    top = selected(scored, weight, coverage)
    net = top[LABEL] - cost
    daily = top.assign(net=net).groupby("date").net.mean()
    return {
        "samples": int(len(top)), "dates": int(top.date.nunique()),
        "coverage": coverage, "rankWeight": weight,
        "netMeanExcess": round(float(net.mean()), 4),
        "netHitRate": round(float((net > 0).mean() * 100), 2),
        "positiveDayRate": round(float((daily > 0).mean() * 100), 2),
    }


def choose(valid_scored: pd.DataFrame, cost: float) -> dict:
    candidates = [metrics(valid_scored, weight, coverage, cost)
                  for coverage in COVERAGES for weight in WEIGHTS]
    # Prefer a real hit-rate edge, then payoff.  If none clears 52%, select the
    # highest hit rate without hiding the failure behind a looser threshold.
    eligible = [item for item in candidates if item["netHitRate"] >= 52 and item["netMeanExcess"] > 0]
    pool = eligible or candidates
    best = max(pool, key=lambda item: (item["netHitRate"], item["netMeanExcess"], -item["coverage"]))
    return {"selected": best, "candidates": candidates}


def calibration_bins(scored: pd.DataFrame, weight: float, cost: float) -> list[dict]:
    frame = scored.copy()
    frame["ensemble"] = weight * frame.rank_pct + (1 - weight) * frame.win_pct
    frame["net"] = frame[LABEL] - cost
    frame["bin"] = pd.qcut(frame.ensemble.rank(method="first"), 10, labels=False)
    return [{
        "min": round(float(group.ensemble.min()), 6),
        "max": round(float(group.ensemble.max()), 6),
        "mid": round(float(group.ensemble.median()), 6),
        "outperformRate": round(float((group.net > 0).mean() * 100), 2),
        "samples": int(len(group)),
    } for _, group in frame.groupby("bin", sort=True)]


def fold_windows(dates: np.ndarray, folds: int) -> list[dict]:
    window = max(60, len(dates) // (folds + 7))
    first_train_end = len(dates) - (folds * 2 + 1) * window
    if first_train_end < 500:
        raise SystemExit("not enough dates for purged walk-forward validation")
    windows = []
    for index in range(folds):
        train_end = first_train_end + index * 2 * window
        valid_start = train_end + HORIZON
        valid_end = valid_start + window
        test_start = valid_end + HORIZON
        test_end = min(test_start + window, len(dates))
        if test_end - test_start < 40:
            break
        windows.append({
            "train_end": dates[train_end], "valid_start": dates[valid_start],
            "valid_end": dates[valid_end], "test_start": dates[test_start],
            "test_end": dates[test_end - 1],
        })
    if len(windows) < 2:
        raise SystemExit("not enough non-overlapping purged folds")
    return windows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("research-v19"))
    parser.add_argument("--folds", type=int, default=3)
    parser.add_argument("--round-trip-cost-bps", type=float, default=30.0)
    args = parser.parse_args()
    cost = args.round_trip_cost_bps / 100.0
    frame = load_frame(args.dataset)
    frame = frame[frame.groupby("date").symbol.transform("count") >= 80].copy()
    frame["relevance"] = frame.groupby("date")[LABEL].transform(lambda x: relevance(x, cost))
    dates = np.array(sorted(frame.date.unique()))
    fold_results, oos_parts = [], []

    for fold, window in enumerate(fold_windows(dates, args.folds), 1):
        train = frame[frame.date < window["train_end"]]
        valid = frame[(frame.date >= window["valid_start"]) & (frame.date < window["valid_end"])]
        test = frame[(frame.date >= window["test_start"]) & (frame.date <= window["test_end"])]
        ranker, classifier = fit_models(train, valid, cost, SEED + fold * 100)
        tuning = choose(score(valid, ranker, classifier), cost)
        choice = tuning["selected"]
        test_scored = score(test, ranker, classifier)
        test_metrics = metrics(test_scored, choice["rankWeight"], choice["coverage"], cost)
        test_scored["fold"] = fold
        test_scored["ensemble"] = choice["rankWeight"] * test_scored.rank_pct + (1 - choice["rankWeight"]) * test_scored.win_pct
        oos_parts.append(test_scored)
        fold_results.append({
            "fold": fold,
            "trainThrough": str(train.date.max().date()),
            "validationFrom": str(valid.date.min().date()), "validationThrough": str(valid.date.max().date()),
            "testFrom": str(test.date.min().date()), "testThrough": str(test.date.max().date()),
            "embargoTradingDays": HORIZON, "validationChoice": choice,
            "testMetrics": test_metrics,
        })
        print(json.dumps(fold_results[-1], ensure_ascii=False), flush=True)

    total_samples = sum(item["testMetrics"]["samples"] for item in fold_results)
    weighted_hit = sum(item["testMetrics"]["netHitRate"] * item["testMetrics"]["samples"] for item in fold_results) / total_samples
    weighted_mean = sum(item["testMetrics"]["netMeanExcess"] * item["testMetrics"]["samples"] for item in fold_results) / total_samples
    positive_folds = sum(item["testMetrics"]["netMeanExcess"] > 0 for item in fold_results)
    approved = weighted_hit >= 52 and weighted_mean > 0 and positive_folds >= (len(fold_results) + 1) // 2

    # Deployable model: tune only on the latest validation window, then train on
    # all earlier data.  The final recent window remains the calibration source.
    valid_start = len(dates) - max(180, len(dates) // 10)
    train_end = valid_start - HORIZON
    train = frame[frame.date < dates[train_end]]
    valid = frame[frame.date >= dates[valid_start]]
    ranker, classifier = fit_models(train, valid, cost, SEED + 999)
    final_scored = score(valid, ranker, classifier)
    final_choice = choose(final_scored, cost)["selected"]

    rank_iterations = max(1, int(ranker.best_iteration_))
    classifier_iterations = max(1, int(classifier.best_iteration_))
    calibration = calibration_bins(final_scored, final_choice["rankWeight"], cost)
    # Once model shape and selection policy are frozen, refit on every labelled
    # observation so the deployable model uses the most recent available labels.
    ranker = make_ranker(SEED + 1001).set_params(n_estimators=rank_iterations)
    ranker.fit(
        frame[FEATURES], frame.relevance,
        group=frame.groupby("date", sort=True).size().to_numpy(),
    )
    classifier = make_classifier(SEED + 1002).set_params(n_estimators=classifier_iterations)
    classifier.fit(frame[FEATURES], (frame[LABEL] - cost > 0).astype("int8"))

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "lambdarank-20d-v19.json").write_text(
        json.dumps(ranker.booster_.dump_model(), ensure_ascii=False), encoding="utf-8")
    (args.output / "classifier-20d-v19.json").write_text(
        json.dumps(classifier.booster_.dump_model(), ensure_ascii=False), encoding="utf-8")
    report = {
        "schema": 1, "engine": "LightGBM 20-day ranker + net-win classifier",
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "labelThrough": str(frame.date.max().date()), "rows": int(len(frame)),
        "symbols": int(frame.symbol.nunique()), "roundTripCostBps": args.round_trip_cost_bps,
        "validation": {
            "mode": "nested purged walk-forward", "embargoTradingDays": HORIZON,
            "folds": fold_results, "weightedNetHitRate": round(weighted_hit, 2),
            "weightedNetMeanExcess": round(weighted_mean, 4),
            "positiveFolds": positive_folds, "approved": approved,
            "minimumNetHitRate": 52.0,
        },
        "deploymentCandidate": {
            "rankerFile": "lambdarank-20d-v19.json", "classifierFile": "classifier-20d-v19.json",
            "rankWeight": final_choice["rankWeight"], "coverage": final_choice["coverage"],
            "rankerBestIteration": rank_iterations,
            "classifierBestIteration": classifier_iterations,
            "calibration": calibration,
            "enabled": approved,
        },
    }
    (args.output / "v19-training-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
