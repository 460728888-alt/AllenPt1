#!/usr/bin/env python3
"""Build a leakage-aware A-share ranking dataset from Microsoft Qlib data.

The input directory is an already-downloaded Qlib China daily bundle.  CSI 300
and CSI 500 membership files are used so suspended/unlisted dates are respected
by Qlib.  Labels are future returns relative to the same-date universe median;
they are used only as labels and never as features.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import qlib
from qlib.constant import REG_CN
from qlib.data import D


HORIZONS = (5, 20, 60)
FIELDS = [
    "$close/Ref($close,5)-1",
    "$close/Ref($close,20)-1",
    "$close/Ref($close,60)-1",
    "Mean($close,5)/Mean($close,20)-1",
    "Mean($close,20)/Mean($close,60)-1",
    "Std($close/Ref($close,1)-1,20)",
    "Mean($volume,5)/Mean($volume,20)",
    "$close/Max($high,20)-1",
    "$close/Min($low,20)-1",
    "Ref($close,-5)/$close-1",
    "Ref($close,-20)/$close-1",
    "Ref($close,-60)/$close-1",
]
NAMES = [
    "return5", "return20", "return60", "maGap5To20", "maGap20To60",
    "volatility20", "volumeRatio5To20", "distanceToHigh20",
    "distanceToLow20", "future_return_5", "future_return_20",
    "future_return_60",
]


def fetch_market(market: str, start: str, end: str) -> pd.DataFrame:
    frame = D.features(
        D.instruments(market), FIELDS, start_time=start, end_time=end,
        freq="day", disk_cache=0,
    )
    if frame.empty:
        raise RuntimeError(f"Qlib market {market!r} returned no rows")
    frame = frame.copy()
    frame.columns = NAMES
    frame = frame.reset_index()
    # Qlib versions may return either order, but preserve these canonical names.
    if "instrument" not in frame.columns or "datetime" not in frame.columns:
        raise RuntimeError(f"unexpected Qlib index columns: {list(frame.columns)}")
    frame = frame.rename(columns={"instrument": "symbol", "datetime": "date"})
    frame["symbol"] = frame["symbol"].astype(str).str.upper().str.replace(
        r"^(SH|SZ)", "", regex=True
    )
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", type=Path, required=True)
    parser.add_argument("--start", default="2010-01-01")
    parser.add_argument("--end", default=None)
    parser.add_argument("--limit", type=int, default=0, help="pilot only; 0 uses CSI 800")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    qlib.init(provider_uri=str(args.provider), region=REG_CN)
    frames, failures = [], []
    for market in ("csi300", "csi500"):
        try:
            frames.append(fetch_market(market, args.start, args.end))
        except Exception as exc:
            failures.append({"market": market, "reason": str(exc)})
    if not frames:
        raise SystemExit("both Qlib CSI markets failed: " + json.dumps(failures))

    data = pd.concat(frames, ignore_index=True)
    data = data.drop_duplicates(["date", "symbol"]).sort_values(["date", "symbol"])
    if args.limit:
        keep = sorted(data.symbol.unique())[: args.limit]
        data = data[data.symbol.isin(keep)]

    percentage_features = [
        "return5", "return20", "return60", "maGap5To20", "maGap20To60",
        "volatility20", "distanceToHigh20", "distanceToLow20",
    ]
    data[percentage_features] = data[percentage_features] * 100
    for horizon in HORIZONS:
        raw = f"future_return_{horizon}"
        median = data.groupby("date")[raw].transform("median")
        data[f"future_excess_{horizon}"] = (data[raw] - median) * 100

    # Disclosure-safe placeholders: never backfill today's fundamentals into
    # historical rows. They can be replaced once filing-publication snapshots
    # are available.
    neutral = {
        "revenueGrowth": 0.0, "profitGrowth": 0.0, "netMargin": 0.0,
        "debtRatio": 50.0, "timedEventCount": 0.0,
        "positiveEvidenceCount": 0.0, "negativeEvidenceCount": 0.0,
        "bodyEvidenceCount": 0.0,
    }
    for column, value in neutral.items():
        data[column] = value

    columns = [
        "date", "symbol", "return5", "return20", "return60", "maGap5To20",
        "maGap20To60", "volatility20", "volumeRatio5To20", "distanceToHigh20",
        "distanceToLow20", *neutral.keys(), "future_excess_5",
        "future_excess_20", "future_excess_60",
    ]
    data = data[columns].replace([np.inf, -np.inf], np.nan)
    data = data.dropna(subset=["return60", "future_excess_60"])
    minimum = min(80, max(20, data.symbol.nunique() // 3))
    daily_count = data.groupby("date").symbol.transform("nunique")
    data = data[daily_count >= minimum].sort_values(["date", "symbol"])
    if data.date.nunique() < 300 or data.symbol.nunique() < 80:
        raise SystemExit(
            f"insufficient Qlib data: {data.date.nunique()} dates, "
            f"{data.symbol.nunique()} symbols"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    data.to_parquet(args.output, index=False)
    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": "Microsoft Qlib public China daily bundle",
        "sourceUrl": "https://github.com/microsoft/qlib",
        "universe": "Qlib point-in-time CSI 300 plus CSI 500 membership",
        "rows": int(len(data)), "symbols": int(data.symbol.nunique()),
        "dates": int(data.date.nunique()),
        "dateFrom": str(data.date.min().date()),
        "dateThrough": str(data.date.max().date()),
        "labelBenchmark": "same-date CSI 800 median future return",
        "limitations": [
            "Qlib public bundle is research data, not real-time broker data",
            "bundle freshness is recorded by dateThrough and may lag the market",
            "financial and announcement features remain neutral in this bootstrap model",
        ],
        "marketFailures": failures,
    }
    args.output.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
