#!/usr/bin/env python3
"""Build a reproducible CSI 300 + CSI 500 LightGBM training dataset.

BaoStock supplies adjusted A-share daily bars without an account token.  This
builder deliberately uses only information known on each trading date.  The
financial and announcement features remain neutral until a disclosure-date-
safe point-in-time source is added; they are never backfilled from today's
company facts.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import date, datetime, timezone
from pathlib import Path

import baostock as bs
import numpy as np
import pandas as pd


HORIZONS = (5, 20, 60)
PRICE_FIELDS = (
    "date,code,open,high,low,close,preclose,volume,amount,"
    "pctChg,turn,tradestatus,isST"
)


def query_rows(result) -> list[list[str]]:
    rows: list[list[str]] = []
    while result.error_code == "0" and result.next():
        rows.append(result.get_row_data())
    if result.error_code != "0":
        raise RuntimeError(f"BaoStock error {result.error_code}: {result.error_msg}")
    return rows


def current_csi800() -> list[str]:
    """Return the deduplicated current CSI 300 and CSI 500 constituents."""
    codes: set[str] = set()
    for query in (bs.query_hs300_stocks, bs.query_zz500_stocks):
        result = query()
        rows = query_rows(result)
        code_index = result.fields.index("code")
        codes.update(row[code_index] for row in rows if row[code_index])
    if len(codes) < 600:
        raise RuntimeError(f"constituent query returned only {len(codes)} symbols")
    return sorted(codes)


def history(code: str, start: str, end: str) -> pd.DataFrame:
    result = bs.query_history_k_data_plus(
        code,
        PRICE_FIELDS,
        start_date=start,
        end_date=end,
        frequency="d",
        adjustflag="2",  # forward adjusted; avoids artificial split/dividend jumps
    )
    rows = query_rows(result)
    frame = pd.DataFrame(rows, columns=result.fields)
    if frame.empty:
        return frame
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    numeric = [
        "open", "high", "low", "close", "preclose", "volume", "amount",
        "pctChg", "turn", "tradestatus", "isST",
    ]
    frame[numeric] = frame[numeric].apply(pd.to_numeric, errors="coerce")
    frame["symbol"] = code.split(".")[-1]
    return frame.dropna(subset=["date", "close"]).sort_values("date")


def add_features(frame: pd.DataFrame, benchmark: pd.Series) -> pd.DataFrame:
    out = frame.copy()
    close = out["close"]
    volume = out["volume"].replace(0, np.nan)
    daily_return = close.pct_change(fill_method=None) * 100

    out["return5"] = close.pct_change(5, fill_method=None) * 100
    out["return20"] = close.pct_change(20, fill_method=None) * 100
    out["return60"] = close.pct_change(60, fill_method=None) * 100
    average5 = close.rolling(5).mean()
    average20 = close.rolling(20).mean()
    average60 = close.rolling(60).mean()
    out["maGap5To20"] = (average5 / average20 - 1) * 100
    out["maGap20To60"] = (average20 / average60 - 1) * 100
    out["volatility20"] = daily_return.rolling(20).std(ddof=0)
    out["volumeRatio5To20"] = volume.rolling(5).mean() / volume.rolling(20).mean()
    out["distanceToHigh20"] = (close / close.rolling(20).max() - 1) * 100
    out["distanceToLow20"] = (close / close.rolling(20).min() - 1) * 100

    # Neutral placeholders.  Using today's financial facts historically would
    # leak the future, so these stay constant until report-publication dates are
    # available for every observation.
    out["revenueGrowth"] = 0.0
    out["profitGrowth"] = 0.0
    out["netMargin"] = 0.0
    out["debtRatio"] = 50.0
    out["timedEventCount"] = 0.0
    out["positiveEvidenceCount"] = 0.0
    out["negativeEvidenceCount"] = 0.0
    out["bodyEvidenceCount"] = 0.0

    benchmark_close = out["date"].map(benchmark)
    for horizon in HORIZONS:
        stock_future = close.shift(-horizon) / close - 1
        benchmark_future = benchmark_close.shift(-horizon) / benchmark_close - 1
        out[f"future_excess_{horizon}"] = (stock_future - benchmark_future) * 100
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", default="2018-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--limit", type=int, default=0, help="pilot only; 0 means full CSI 800")
    parser.add_argument("--pause", type=float, default=0.04)
    parser.add_argument("--output", type=Path, default=Path("ml/data/baostock-csi800.parquet"))
    args = parser.parse_args()

    login = bs.login()
    if login.error_code != "0":
        raise SystemExit(f"BaoStock login failed {login.error_code}: {login.error_msg}")
    failures: list[dict[str, str]] = []
    try:
        symbols = current_csi800()
        if args.limit:
            symbols = symbols[: args.limit]
        benchmark_frame = history("sh.000001", args.start, args.end)
        if benchmark_frame.empty:
            raise RuntimeError("Shanghai Composite history is empty")
        benchmark = benchmark_frame.set_index("date")["close"]

        frames: list[pd.DataFrame] = []
        for index, code in enumerate(symbols, 1):
            try:
                frame = history(code, args.start, args.end)
                if len(frame) >= 380:
                    frames.append(add_features(frame, benchmark))
                else:
                    failures.append({"code": code, "reason": f"only {len(frame)} bars"})
            except Exception as exc:  # one suspended/delisted symbol must not abort all training
                failures.append({"code": code, "reason": str(exc)})
            if index % 25 == 0 or index == len(symbols):
                print(
                    f"downloaded {index}/{len(symbols)}; usable={len(frames)}; failed={len(failures)}",
                    flush=True,
                )
            time.sleep(args.pause)
    finally:
        bs.logout()

    if not frames:
        raise SystemExit("no usable histories downloaded")
    dataset = pd.concat(frames, ignore_index=True)
    columns = [
        "date", "symbol", "return5", "return20", "return60", "maGap5To20",
        "maGap20To60", "volatility20", "volumeRatio5To20", "distanceToHigh20",
        "distanceToLow20", "revenueGrowth", "profitGrowth", "netMargin", "debtRatio",
        "timedEventCount", "positiveEvidenceCount", "negativeEvidenceCount",
        "bodyEvidenceCount", "future_excess_5", "future_excess_20", "future_excess_60",
    ]
    dataset = dataset[columns].replace([np.inf, -np.inf], np.nan)
    dataset = dataset.dropna(subset=["return60", "future_excess_60"])
    daily_count = dataset.groupby("date")["symbol"].transform("nunique")
    dataset = dataset[daily_count >= min(80, max(20, len(frames) // 3))]
    dataset = dataset.sort_values(["date", "symbol"])
    if dataset["date"].nunique() < 300 or dataset["symbol"].nunique() < 80:
        raise SystemExit(
            f"insufficient usable data: {dataset.date.nunique()} dates, "
            f"{dataset.symbol.nunique()} symbols"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_parquet(args.output, index=False)
    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": "BaoStock adjusted daily A-share bars",
        "sourceUrl": "https://www.baostock.com/",
        "universe": "current CSI 300 plus current CSI 500 constituents",
        "requestedSymbols": len(symbols),
        "usableSymbols": int(dataset["symbol"].nunique()),
        "rows": int(len(dataset)),
        "dates": int(dataset["date"].nunique()),
        "dateFrom": str(dataset["date"].min().date()),
        "dateThrough": str(dataset["date"].max().date()),
        "benchmark": "Shanghai Composite (sh.000001)",
        "adjustment": "forward adjusted (BaoStock adjustflag=2)",
        "limitations": [
            "current-index constituents introduce survivorship bias",
            "financial and announcement features are neutral in this first model",
            "prices are research data and may differ from broker snapshots",
        ],
        "failures": failures[:100],
    }
    metadata_path = args.output.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
