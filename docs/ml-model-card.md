# SentryMax Fire-Spread Model — Model Card

> **Status:** placeholder. This document is **mandatory** before any model is
> promoted from MLflow `Staging` → `Production` (PRD §5.6). It is filled in
> with concrete values during Stage 3 training.

## Model details

| Field | Value |
| --- | --- |
| Model name | `fire-spread` |
| Version | _filled at promotion_ |
| Architecture | Physics-informed cellular automata baseline (Rothermel 1972) + U-Net with ConvLSTM bottleneck (primary) |
| Inputs | 14-channel raster, 256 × 256, 30 m / pixel, 4 past time steps |
| Outputs | 3 burn-probability rasters (1 h / 6 h / 24 h horizons) |
| Format | ONNX, int8-quantized |
| License | _filled at first publication_ |
| Owner | Agent A (claude) — contact in repo `CODEOWNERS` |

## Intended use

- **In scope:** assistive triage for wildland fire dispatchers in CONUS
  (continental US), AK, and HI. Augments — does not replace — civilian 911
  reporting and human dispatcher judgement.
- **Out of scope:** structure fires, prescribed-burn dispatch (verification
  filters those out before the model sees them), international (no validated
  fuel/weather coverage).
- **Decision boundary:** the model output is *advisory*. The human
  dispatcher is always the actor pressing "Dispatch."

## Training data

| Source | Coverage | Role |
| --- | --- | --- |
| FIRMS (VIIRS + MODIS) | 2012 – present | Ground-truth fire presence |
| NIFC Wildfire Perimeters | 2000 – present | Gold perimeters for IoU eval |
| HRRR reanalysis | 2014 – present | Wind U/V, humidity, temp |
| LANDFIRE FBFM40 / CBD / CC | 2014, 2016, 2020, 2022 | Fuel model, canopy |
| SRTM | static | Elevation, slope, aspect |
| Open-Meteo historical | 2014 – present | HRRR fallback |

Sample construction, rebalancing, and ecoregion stratification are
documented in PRD §5.2.

## Performance

| Metric | Train | Val | Test | Target |
| --- | --- | --- | --- | --- |
| 1 h fire-front IoU | _tbd_ | _tbd_ | _tbd_ | ≥ 0.65 |
| 6 h fire-front IoU | _tbd_ | _tbd_ | _tbd_ | ≥ 0.55 |
| 24 h fire-front IoU | _tbd_ | _tbd_ | _tbd_ | ≥ 0.40 |
| Burned-area MAE (acres) | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| Per-pixel ECE | _tbd_ | _tbd_ | _tbd_ | ≤ 0.05 |
| Inference p95 (CPU, ONNX int8) | _tbd_ | _tbd_ | _tbd_ | < 800 ms |

Per-ecoregion slices (Bailey's domains) are tracked separately. Promotion
requires no regression on any slice — see PRD §5.6.

## Known limitations

- **Long-horizon uncertainty.** 24 h IoU is materially weaker than 6 h. The
  console renders the 24 h overlay with reduced opacity + a "Low-confidence
  horizon" label when per-fire reliability ≤ 0.30 (Appendix A item 2 in PRD).
- **Bias toward large fires.** FIRMS over-represents large, persistent,
  daytime fires (overpass schedule + thermal threshold). Rebalancing —
  oversampling the first 6 h of each fire and stratifying by ecoregion —
  partially mitigates but does not eliminate this. Small / short-lived
  fires < ~50 acres are out of distribution.
- **Structure-fire physics.** The model is trained on wildland fuel only.
  Predictions inside / adjacent to the WUI (wildland-urban interface) are
  reasonable for the *wildland* portion only; structure-fire dynamics differ.
- **Wind data freshness.** HRRR is hourly; between cycles, predictions use
  stale wind. The fallback to Open-Meteo is documented in the response
  (`context_source: "open-meteo"`); the model card should not be interpreted
  as covering forecast horizons that exceed the wind-data cycle.

## Failure modes & monitoring

- **Drift.** Weekly distribution comparison vs. training set on wind speed,
  fuel-class mix, ecoregion. KL divergence > threshold → page on-call.
- **Calibration drift.** Per-pixel ECE recomputed monthly against new
  observations. Promote rollback if ECE worsens.
- **Out-of-distribution flags.** Predictions outside CONUS+AK+HI bounding
  box, or for fuel classes outside FBFM40, return `reliability: "low"` per
  the prediction contract.

## Ethics

- Public surfaces (Public Awareness Map) only show `EMERGING+` predictions
  — `UNREPORTED` satellite-only hits are suppressed in v1 to avoid civilian
  alarm. Predictions are server-redacted via `toPublicEvent()` in
  `packages/contracts/incident-events.ts`; the redaction boundary is
  enforced by a contract test.
- Dispatch decisions are always human-in-the-loop (PRD §1.3). The model
  never auto-fires a webhook to a station.
- The model card is publicly published (Appendix A item 5 — pending ADR).

## Versioning & retention

- Every promoted model is tagged in MLflow with the dataset shard hashes,
  git commit, hyperparameters, and an evaluation report.
- Old model versions are retained indefinitely for replay and audit
  (PRD §10 retention — Codex).
- Rollback is one click in the Admin UI (PRD §4.3).
