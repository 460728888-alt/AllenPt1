#!/usr/bin/env python3
"""Build a recent A-share research dataset from Yahoo chart histories.

The symbol universe comes from the CSI 300/500 instrument files bundled by
Microsoft Qlib. Yahoo is used only for price/volume history. This is a free
research fallback, not exchange-licensed production market data; metadata
records the survivorship and availability limitations explicitly.
"""
from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

HORIZONS = (5, 20, 60)
USER_AGENT = "Mozilla/5.0 AllenStockResearch/1.17"


def universe(provider: Path) -> list[str]:
    result = set()
    for name in ("csi300.txt", "csi500.txt"):
        source = provider / "instruments" / name
        if not source.exists():
            raise SystemExit(f"missing Qlib instrument file: {source}")
        for line in source.read_text(encoding="utf-8").splitlines():
            raw = line.split("\t", 1)[0].strip().upper()
            code = raw.removeprefix("SH").removeprefix("SZ")
            if len(code) == 6 and code.isdigit():
                result.add(code)
    if len(result) < 80:
        raise SystemExit(f"insufficient CSI universe: {len(result)} symbols")
    return sorted(result)


def yahoo_symbol(code: str) -> str:
    return code + (".SS" if code.startswith("6") else ".SZ")


def download(code: str, start_epoch: int, end_epoch: int, attempts: int = 4) -> pd.DataFrame:
    symbol = yahoo_symbol(code)
    last = None
    for attempt in range(attempts):
        host = "query1.finance.yahoo.com" if attempt % 2 == 0 else "query2.finance.yahoo.com"
        url = (
            f"https://{host}/v8/finance/chart/{symbol}?period1={start_epoch}"
            f"&period2={end_epoch}&interval=1d&events=div%2Csplits"
        )
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=35) as response:
                payload = json.load(response)
            result = (payload.get("chart", {}).get("result") or [None])[0]
            if not result:
                raise RuntimeError(str(payload.get("chart", {}).get("error") or "empty chart"))
            timestamps = result.get("timestamp") or []
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            adjusted = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or quote.get("close") or []
            rows = []
            for index, timestamp in enumerate(timestamps):
                raw_close = quote.get("close", [])[index] if index < len(quote.get("close", [])) else None
                adj_close = adjusted[index] if index < len(adjusted) else None
                if not raw_close or not adj_close:
                    continue
                ratio = float(adj_close) / float(raw_close)
                high = quote.get("high", [])[index] if index < len(quote.get("high", [])) else raw_close
                low = quote.get("low", [])[index] if index < len(quote.get("low", [])) else raw_close
                volume = quote.get("volume", [])[index] if index < len(quote.get("volume", [])) else 0
                rows.append({
                    "date": pd.to_datetime(timestamp, unit="s", utc=True).tz_convert("Asia/Shanghai").tz_localize(None).normalize(),
                    "symbol": code, "close": float(adj_close),
                    "high": float(high or raw_close) * ratio,
                    "low": float(low or raw_close) * ratio,
                    "volume": float(volume or 0),
                })
            frame = pd.DataFrame(rows)
            if len(frame) < 180:
                raise RuntimeError(f"only {len(frame)} usable rows")
            return frame
        except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(min(8, 1.5 ** attempt))
    raise RuntimeError(str(last))


def add_features(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.sort_values("date").copy()
    close, volume = frame.close, frame.volume
    ma5, ma20, ma60 = close.rolling(5).mean(), close.rolling(20).mean(), close.rolling(60).mean()
    frame["return5"] = (close / close.shift(5) - 1) * 100
    frame["return20"] = (close / close.shift(20) - 1) * 100
    frame["return60"] = (close / close.shift(60) - 1) * 100
    frame["maGap5To20"] = (ma5 / ma20 - 1) * 100
    frame["maGap20To60"] = (ma20 / ma60 - 1) * 100
    frame["volatility20"] = close.pct_change(fill_method=None).rolling(20).std(ddof=0) * 100
    frame["volumeRatio5To20"] = volume.rolling(5).mean() / volume.rolling(20).mean()
    frame["distanceToHigh20"] = (close / frame.high.rolling(20).max() - 1) * 100
    frame["distanceToLow20"] = (close / frame.low.rolling(20).min() - 1) * 100
    for horizon in HORIZONS:
        frame[f"future_return_{horizon}"] = close.shift(-horizon) / close - 1
    return frame


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", type=Path, required=True)
    parser.add_argument("--start", default="2016-01-01")
    parser.add_argument("--end", default=None)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    codes = universe(args.provider)
    if args.limit:
        codes = codes[: args.limit]
    start = pd.Timestamp(args.start, tz="UTC")
    end = pd.Timestamp(args.end, tz="UTC") if args.end else pd.Timestamp.now(tz="UTC") + timedelta(days=1)
    frames, failures = [], []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 12))) as executor:
        jobs = {executor.submit(download, code, int(start.timestamp()), int(end.timestamp())): code for code in codes}
        for completed, future in enumerate(as_completed(jobs), 1):
            code = jobs[future]
            try:
                frames.append(add_features(future.result()))
            except Exception as exc:
                failures.append({"symbol": code, "reason": str(exc)[:200]})
            if completed % 50 == 0 or completed == len(jobs):
                print(f"downloaded {completed}/{len(jobs)}; usable={len(frames)}; failed={len(failures)}", flush=True)
    if len(frames) < 80:
        raise SystemExit(f"only {len(frames)} symbols downloaded; refusing to train")

    data = pd.concat(frames, ignore_index=True).drop_duplicates(["date", "symbol"])
    for horizon in HORIZONS:
        raw = f"future_return_{horizon}"
        median = data.groupby("date")[raw].transform("median")
        data[f"future_excess_{horizon}"] = (data[raw] - median) * 100

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
        "distanceToLow20", *neutral.keys(), "future_excess_5", "future_excess_20",
        "future_excess_60",
    ]
    data = data[columns].replace([np.inf, -np.inf], np.nan)
    data = data.dropna(subset=["return60"])
    minimum = min(80, max(20, data.symbol.nunique() // 3))
    data = data[data.groupby("date").symbol.transform("nunique") >= minimum]
    data = data.sort_values(["date", "symbol"])
    if data.date.nunique() < 300:
        raise SystemExit(f"only {data.date.nunique()} usable dates; refusing to train")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    data.to_parquet(args.output, index=False)
    metadata = {
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance daily chart history",
        "sourceUrl": "https://finance.yahoo.com/",
        "universe": "Union of CSI 300 and CSI 500 symbols recorded in Microsoft Qlib instrument files",
        "rows": int(len(data)), "symbols": int(data.symbol.nunique()),
        "requestedSymbols": len(codes), "failedSymbols": len(failures),
        "dates": int(data.date.nunique()), "dateFrom": str(data.date.min().date()),
        "dateThrough": str(data.date.max().date()),
        "labelBenchmark": "same-date downloaded-universe median future return",
        "limitations": [
            "Yahoo chart data is a free research fallback, not exchange-licensed production data",
            "the Qlib instrument union is not exact point-in-time membership after the Qlib bundle end date",
            "delisted or unavailable symbols may be missing and create survivorship bias",
            "financial and announcement features remain neutral in this price-only model",
        ],
        "failureExamples": failures[:30],
    }
    args.output.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
