"""Lightweight pretrained forecasting service for Allen Stock.

Uses Amazon Chronos-Bolt (Apache-2.0). It forecasts price quantiles; it does
not claim calibrated stock-return probabilities or investment certainty.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import List

import numpy as np
import torch
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.getenv("CHRONOS_MODEL", "amazon/chronos-bolt-tiny")
API_TOKEN = os.getenv("FORECAST_API_TOKEN", "")
QUANTILE_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9]

app = FastAPI(title="Allen Forecast Committee", version="1.15.0")


class ForecastRequest(BaseModel):
    prices: List[float] = Field(min_length=100, max_length=1024)
    horizons: List[int] = Field(default=[5, 20, 60], min_length=1, max_length=6)


@lru_cache(maxsize=1)
def pipeline():
    from chronos import BaseChronosPipeline
    return BaseChronosPipeline.from_pretrained(
        MODEL_ID, device_map="cpu", dtype=torch.float32
    )


def authorize(value: str | None) -> None:
    if API_TOKEN and value != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="模型服务认证失败")


def probability_above(quantiles: np.ndarray, threshold: float) -> float:
    """Approximate P(value > threshold) from forecast quantiles.

    This is explicitly an interpolation of model quantiles, not a historically
    calibrated probability of a stock rising.
    """
    values=np.maximum.accumulate(np.asarray(quantiles,dtype=float))
    levels=np.asarray(QUANTILE_LEVELS,dtype=float)
    if threshold < values[0]:
        cdf=max(0.0, levels[0]*(threshold/max(values[0],1e-9)))
    elif threshold > values[-1]:
        span=max(values[-1]-values[-2],1e-9)
        cdf=min(1.0,levels[-1]+(1-levels[-1])*(threshold-values[-1])/span)
    else:
        cdf=float(np.interp(threshold,values,levels))
    return round((1-cdf)*100,1)


@app.get("/health")
def health():
    return {"ok": True, "engine": "Amazon Chronos-Bolt", "model": MODEL_ID, "loaded": pipeline.cache_info().currsize > 0}


@app.post("/forecast")
def forecast(request: ForecastRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    prices=np.asarray(request.prices,dtype=np.float32)
    if not np.isfinite(prices).all() or np.any(prices<=0):
        raise HTTPException(status_code=400,detail="价格序列包含无效值")
    horizons=sorted(set(int(x) for x in request.horizons if 1<=int(x)<=120))
    if not horizons:
        raise HTTPException(status_code=400,detail="预测周期无效")
    quantiles,mean=pipeline().predict_quantiles(
        context=torch.tensor(prices[-512:]),
        prediction_length=max(horizons),
        quantile_levels=QUANTILE_LEVELS,
    )
    q=quantiles[0].detach().cpu().numpy()
    avg=mean[0].detach().cpu().numpy()
    current=float(prices[-1])
    items=[]
    for days in horizons:
        end=q[days-1]
        median=float(end[2])
        items.append({
            "days":days,"currentPrice":round(current,4),
            "lowPrice":round(float(end[0]),4),"lowerMiddlePrice":round(float(end[1]),4),
            "medianPrice":round(median,4),"upperMiddlePrice":round(float(end[3]),4),
            "highPrice":round(float(end[4]),4),"meanPrice":round(float(avg[days-1]),4),
            "expectedReturn":round((median/current-1)*100,2),
            "upProbability":probability_above(end,current),
            "probabilityType":"模型分位数插值，未经A股历史校准",
        })
    return {
        "engine":"Amazon Chronos-Bolt","model":MODEL_ID,
        "models":[{"id":MODEL_ID,"role":"预训练价格路径模型","license":"Apache-2.0"}],
        "contextPoints":int(len(prices)),"horizons":items,
        "notice":"模型输出为价格分布研究结果，不是收益保证；须结合滚动验证、事件证据和风险收益比。",
    }
