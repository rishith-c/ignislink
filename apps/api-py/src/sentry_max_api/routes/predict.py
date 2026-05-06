"""POST /predict/spread — fire-spread ML prediction.

Mirrors the contract in ``packages/contracts/src/predict-spread.ts``.

Pipeline:
    1. Compute deterministic ``input_hash`` from the request.
    2. Look up cached response in Redis (15-min TTL by default).
    3. On miss: synthesize a context tensor, run ONNX inference off the
       event loop, build the per-horizon contour stub, cache the result.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Awaitable, cast

from fastapi import APIRouter, Depends, HTTPException, Request, status
from redis.asyncio import Redis

from sentry_max_api.contracts import (
    PredictSpreadRequest,
    PredictSpreadResponse,
)
from sentry_max_api.onnx_loader import FireSpreadOnnx, synthesize_input
from sentry_max_api.settings import Settings, get_settings
from sentry_max_api.spread_post import build_horizon_results


router = APIRouter(prefix="/predict", tags=["predict"])


_INPUT_HASH_DELIMITER = "|"


def derive_input_hash(req: PredictSpreadRequest, model_version: str) -> str:
    """SHA-256 over (detection_id|model_version|wind sample_at|context key).

    Mirrors the canonicalization in ``packages/contracts/src/predict-spread.ts``.
    """

    parts = [
        str(req.detection_id),
        model_version,
        req.wind_summary.sample_at.isoformat().replace("+00:00", "Z"),
        req.context_raster_key,
    ]
    canonical = _INPUT_HASH_DELIMITER.join(parts)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def _fetch_cached(
    redis_client: Redis | None, cache_key: str
) -> PredictSpreadResponse | None:
    if redis_client is None:
        return None
    try:
        raw = await cast(Awaitable[bytes | None], redis_client.get(cache_key))
    except Exception:
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        cached = PredictSpreadResponse.model_validate(payload)
        return cached.model_copy(update={"cache_hit": True})
    except Exception:
        return None


async def _store_cached(
    redis_client: Redis | None,
    cache_key: str,
    response: PredictSpreadResponse,
    ttl_seconds: int,
) -> None:
    if redis_client is None:
        return
    try:
        await cast(
            Awaitable[bool],
            redis_client.set(
                cache_key,
                response.model_dump_json(),
                ex=ttl_seconds,
            ),
        )
    except Exception:
        # Cache is best-effort; never fail the request because of it.
        return


@router.post("/spread", response_model=PredictSpreadResponse)
async def predict_spread(
    body: PredictSpreadRequest,
    request: Request,
    settings: Settings = Depends(get_settings),
) -> PredictSpreadResponse:
    started = time.perf_counter()

    onnx_session = cast(FireSpreadOnnx | None, request.app.state.onnx_session)
    redis_client = cast(Redis | None, request.app.state.redis)

    input_hash = derive_input_hash(body, settings.model_version)
    cache_key = f"predict:spread:{input_hash}"

    cached = await _fetch_cached(redis_client, cache_key)
    if cached is not None:
        return cached

    if onnx_session is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ONNX model is not loaded",
        )

    # Build a synthetic context — in production this would be loaded from
    # MinIO via ``body.context_raster_key``. The synthetic context is
    # parameterized by the wind summary so the predictions reflect the
    # request's atmospheric state.
    grid_size = 64
    x = synthesize_input(
        grid_size=grid_size,
        wind_u=body.wind_summary.u_ms,
        wind_v=body.wind_summary.v_ms,
    )

    # Run inference off the event loop with a 5-second guard.
    try:
        probability = await asyncio.wait_for(onnx_session.infer(x), timeout=5.0)
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="ONNX inference timed out",
        ) from exc

    horizons = build_horizon_results(
        probability,
        hotspot_lonlat=(body.hotspot.coordinates[0], body.hotspot.coordinates[1]),
        horizons_min=body.horizons_min,
    )

    inference_ms = int((time.perf_counter() - started) * 1000)
    response = PredictSpreadResponse(
        schema_version=1,
        model_version=settings.model_version,
        generated_at=datetime.now(timezone.utc),
        horizons=horizons,
        inference_ms=inference_ms,
        cache_hit=False,
        input_hash=input_hash,
        context_source="hrrr",
    )

    await _store_cached(
        redis_client, cache_key, response, settings.predict_cache_ttl_seconds
    )
    return response
