# `ml/` — Fire-spread training pipeline

Code lives here for the IgnisLink fire-spread ML model. Per PRD §5.

## Layout

```
ml/
├── data/
│   ├── raw/         # FIRMS archive, NIFC perimeters, HRRR reanalysis (gitignored)
│   ├── processed/   # Co-registered NetCDF tiles (gitignored)
│   ├── shards/      # WebDataset .tar shards (gitignored, S3 in prod)
│   └── fixtures/    # Tiny golden-file rasters used by unit tests (committed)
├── models/
│   ├── rothermel.py # Physics-informed CA baseline (Stage 3.A)
│   └── unet_convlstm.py # U-Net + ConvLSTM primary model (Stage 3.B)
├── training/
│   ├── train.py     # Lightning-driven training loop with MLflow tracking
│   ├── config.py    # Hyperparameter dataclasses
│   └── dataset.py   # WebDataset shard reader + augmentations
├── eval/            # Eval reports per run (gitignored except summary.md)
└── notebooks/       # Exploration only — never imported by training code
```

## Getting started

```bash
cd ml
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Environment

The training pipeline reads:

- `MLFLOW_TRACKING_URI` (default: `http://localhost:5000`)
- `EARTHDATA_USERNAME`, `EARTHDATA_PASSWORD` (NASA SRTM)
- `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` (optional GPU compute)

See `.env.example` at the repo root for the full schema.

## Commands

| Goal | Command |
| --- | --- |
| Fetch a fresh FIRMS slice | `python -m training.fetch_firms --bbox CONUS --since 30d` |
| Build WebDataset shards | `python -m training.build_shards --shard-size 1024` |
| Train baseline (Rothermel sanity) | `python -m training.train --config configs/rothermel.yaml` |
| Train primary U-Net+ConvLSTM | `python -m training.train --config configs/unet_convlstm.yaml` |
| Eval against held-out perimeters | `python -m training.eval --run-id <mlflow_run>` |
| Export to ONNX | `python -m training.export_onnx --run-id <mlflow_run>` |

## Model card

`docs/ml-model-card.md` is **mandatory** before any model is promoted from
MLflow `Staging` to `Production`. It documents training data, intended use,
limitations, ecoregion coverage, and known failure modes.

## Notes

- All real data (FIRMS, HRRR, LANDFIRE, SRTM) is gitignored — see root
  `.gitignore`. Only `ml/data/fixtures/**/*.tif` is committed.
- Notebooks are for exploration only. Anything load-bearing belongs in
  `training/` or `models/` with tests.
- `models/rothermel.py` is a deterministic NumPy implementation; calibrated
  against BehavePlus reference outputs. Used both as a sanity baseline AND as
  an extra input channel to the neural model.
