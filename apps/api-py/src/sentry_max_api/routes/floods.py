"""GET /floods/gauges — latest gauge stage + 6/24/48h quantile forecast.

The forecast mirrors the EA-LSTM head shape (3 horizons × 3 quantiles)
but uses a closed-form persistence-plus-slope estimator so the API does
not pull in the PyTorch dependency. ``ml/models/flood_ealstm.py`` is the
neural-network upgrade path.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy import text

from sentry_max_api.hazard_math import persistence_slope_forecast


router = APIRouter()


class GaugeForecastBin(BaseModel):
    horizon_hours: int
    quantile: float
    stage_ft: float


class GaugeSnapshot(BaseModel):
    gauge_id: str
    state: str | None
    observed_at: datetime
    stage_ft: float | None
    forecast: list[GaugeForecastBin]


class GaugeListResponse(BaseModel):
    items: list[GaugeSnapshot]
    state: str | None
    horizons_hours: tuple[int, int, int]


@router.get("/gauges", response_model=GaugeListResponse)
async def list_gauges(
    request: Request,
    state: str | None = Query(default=None, alias="state"),
    limit: int = Query(default=50, ge=1, le=200),
) -> GaugeListResponse:
    state_norm = state.lower() if state else None
    sessionmaker = getattr(request.app.state, "session_factory", None)
    if sessionmaker is None:
        return GaugeListResponse(
            items=[], state=state_norm, horizons_hours=(6, 24, 48)
        )

    # Pull the latest 24h of observations per gauge so we have history for
    # the slope + variance terms used by the persistence forecast.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    sql = text(
        """
        SELECT gauge_id, observed_at, stage_ft
          FROM gauge_observations
         WHERE observed_at >= :cutoff
           AND (:state IS NULL OR gauge_id LIKE :state_prefix)
         ORDER BY gauge_id ASC, observed_at ASC
        """
    )
    params = {
        "cutoff": cutoff,
        "state": state_norm,
        "state_prefix": f"{state_norm.upper()}-%" if state_norm else "%-%",
    }

    async with sessionmaker() as session:  # type: ignore[misc]
        rows = (await session.execute(sql, params)).mappings().all()

    by_gauge: dict[str, list[tuple[datetime, float]]] = {}
    for row in rows:
        gid = row["gauge_id"]
        if row["stage_ft"] is None:
            continue
        by_gauge.setdefault(gid, []).append((row["observed_at"], float(row["stage_ft"])))

    items: list[GaugeSnapshot] = []
    for gid, history in list(by_gauge.items())[:limit]:
        if not history:
            continue
        latest_t, latest_stage = history[-1]
        forecast_rows = persistence_slope_forecast(history)
        forecast = [
            GaugeForecastBin(
                horizon_hours=int(f["horizon_hours"]),
                quantile=float(f["quantile"]),
                stage_ft=float(f["stage_ft"]),
            )
            for f in forecast_rows
        ]
        items.append(
            GaugeSnapshot(
                gauge_id=gid,
                state=state_norm,
                observed_at=latest_t,
                stage_ft=latest_stage,
                forecast=forecast,
            )
        )

    return GaugeListResponse(
        items=items, state=state_norm, horizons_hours=(6, 24, 48)
    )
