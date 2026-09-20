#!/usr/bin/env python3
"""Build an A-share ranking dataset over HTTPS.

The filename is retained for workflow compatibility.  BaoStock's custom TCP
service is often unreachable from cloud CI runners, so this revision uses
Eastmoney's public HTTPS quote/history endpoints with retries and records the
actual source in metadata.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd


HEADERS = {
    "User-Agent": "Mozilla/5.0 AllenStock/1.16",
    "Referer": "https://quote.eastmoney.com/",
}
HORIZONS = (5, 20, 60)


def get_json(url: str, attempts: int = 5) -> dict:
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            request = Request(url, headers=HEADERS)
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8", errors="replace"))
        except Exception as exc:
            last = exc
            time.sleep(1.0 + attempt * 1.5)
    raise RuntimeError(f"HTTPS request failed after {attempts} attempts: {last}")


def universe(limit: int) -> list[dict]:
    params = {
        "pn": 1,
        "pz": limit,
        "po": 1,
        "np": 1,
        "fltt": 2,
        "invt": 2,
        "fid": "f6",
        "fs": "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
        "fields": "f12,f13,f14,f6",
    }
    endpoints = [
        "https://82.push2.eastmoney.com/api/qt/clist/get?",
        "https://push2.eastmoney.com/api/qt/clist/get?",
    ]
    for endpoint in endpoints:
        try:
            rows = (get_json(endpoint + urlencode(params)).get("data") or {}).get("diff") or []
            items = [
                {
                    "code": str(row.get("f12", "")),
                    "market": int(row.get("f13", 0)),
                    "name": str(row.get("f14", "")),
                }
                for row in rows
                if str(row.get("f12", "")).isdigit()
            ]
            if len(items) >= min(80, limit):
                return items[:limit]
        except Exception as exc:
            print(f"universe endpoint failed: {exc}", flush=True)

    # Official disclosure-site company list fallback.  Use a deterministic
    # sample rather than silently changing the sample on every run.
    payload = get_json("https://www.cninfo.com.cn/new/data/szse_stock.json")
    items = []
    for row in payload.get("stockList") or []:
        code = str(row.get("code", ""))
        if row.get("category") != "A股" or len(code) != 6 or not code.startswith(("0", "3", "6")):
            continue
        items.append({
            "code": code,
            "market": 1 if code.startswith("6") else 0,
            "name": str(row.get("zwjc", "")),
        })
    random.Random(20260921).shuffle(items)
    return items[:limit]


def bars(code: str, market: int, count: int) -> pd.DataFrame:
    params = {
        "secid": f"{market}.{code}",
        "klt": 101,
        "fqt": 1,
        "lmt": count,
        "end": "20500101",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    }
    hosts = ["33", "7", "17", "28", "40", "48", "63", "82"]
    random.Random(code).shuffle(hosts)
    last: Exception | None = None
    payload: dict | None = None
    for host in hosts:
        try:
            url = f"https://{host}.push2his.eastmoney.com/api/qt/stock/kline/get?" + urlencode(params)
            candidate = get_json(url, attempts=2)
            if (candidate.get("data") or {}).get("klines"):
                payload = candidate
                break
        except Exception as exc:
            last = exc
    if payload is None:
        raise RuntimeError(f"all HTTPS history hosts failed: {last}")

    raw = (payload.get("data") or {}).get("klines") or []
    columns = [
        "date", "open", "close", "high", "low", "volume", "amount",
        "amplitude", "pct", "change", "turnover",
    ]
    frame = pd.DataFrame([row.split(",") for row in raw], columns=columns)
    if frame.empty:
        return frame
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in columns[1:]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame["symbol"] = code
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
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path("ml/data/a-share-https.parquet"))
    args = parser.parse_args()

    stock_count = args.limit if args.limit > 0 else 800
    start = pd.Timestamp(args.start)
    end = pd.Timestamp(args.end)
    bars_needed = max(500, int((end - start).days / 7 * 5) + 140)
    names = universe(stock_count)
    if len(names) < 80:
        raise SystemExit(f"only {len(names)} A-share symbols found")

    benchmark_frame = bars("000001", 1, bars_needed)
    benchmark = benchmark_frame.set_index("date")["close"]
    frames: list[pd.DataFrame] = []
    failures: list[dict] = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 6))) as executor:
        jobs = {
            executor.submit(bars, item["code"], item["market"], bars_needed): item
            for item in names
        }
        for index, future in enumerate(as_completed(jobs), 1):
            item = jobs[future]
            try:
                frame = future.result()
                frame = frame[(frame["date"] >= start) & (frame["date"] <= end)]
                if len(frame) >= 380:
                    frames.append(add_features(frame, benchmark))
                else:
                    failures.append({**item, "reason": f"only {len(frame)} bars"})
            except Exception as exc:
                failures.append({**item, "reason": str(exc)})
            if index % 25 == 0 or index == len(names):
                print(
                    f"downloaded {index}/{len(names)}; usable={len(frames)}; failed={len(failures)}",
                    flush=True,
                )

    if not frames:
        raise SystemExit("no usable HTTPS stock histories downloaded")
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
    counts = dataset.groupby("date")["symbol"].transform("nunique")
    dataset = dataset[counts >= 80].sort_values(["date", "symbol"])
    if dataset["date"].nunique() < 300 or dataset["symbol"].nunique() < 80:
        raise SystemExit(
            f"insufficient HTTPS data: {dataset.date.nunique()} dates, "
            f"{dataset.symbol.nunique()} symbols"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    dataset.to_parquet(args.output, index=False)
    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": "Eastmoney public HTTPS adjusted daily bars",
        "universe": "800 liquid A-share sample; CNINFO deterministic fallback",
        "requestedSymbols": len(names),
        "usableSymbols": int(dataset["symbol"].nunique()),
        "rows": int(len(dataset)),
        "dates": int(dataset["date"].nunique()),
        "dateFrom": str(dataset["date"].min().date()),
        "dateThrough": str(dataset["date"].max().date()),
        "benchmark": "Shanghai Composite (1.000001)",
        "limitations": [
            "current liquid-universe sampling introduces survivorship bias",
            "financial and announcement features are neutral in this first model",
            "public endpoint availability is not guaranteed",
        ],
        "failures": failures[:100],
    }
    metadata_path = args.output.with_suffix(".metadata.json")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
