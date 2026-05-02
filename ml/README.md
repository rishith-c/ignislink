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
│   ├── rothermel.py     # Rothermel (1972) surface fire-spread + CA baseline
│   └── unet_convlstm.py # U-Net + ConvLSTM primary model
├── training/
│   ├── train.py        # Lightning-driven training loop, MLflow tracking
│   ├── eval.py         # Per-horizon fire-front IoU on a held-out set
│   ├── export_onnx.py  # ONNX export (opset 17) + onnxruntime verification
│   ├── losses.py       # Weighted BCE + Dice + FireFrontIoU
│   └── dataset.py      # SyntheticFireDataset + WebDataset stub
├── __tests__/          # pytest tests (run with `python3 -m pytest ml/__tests__`)
├── eval/               # Eval reports per run (gitignored except summary.md)
└── notebooks/          # Exploration only — never imported by training code
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

All commands are run from the repo root (so the `ml.*` package paths
resolve). The synthetic smoke run is the first thing to verify a fresh
checkout — it exercises the full Stage 3 chain without any external data.

| Goal | Command |
| --- | --- |
| Run all ML tests | `python3 -m pytest ml/__tests__` |
| Smoke-train the U-Net+ConvLSTM | `python3 -m ml.training.train --synthetic --max-epochs 2` |
| Train at full resolution | `python3 -m ml.training.train --synthetic --grid 256 --max-epochs 20 --base-channels 64 --batch-size 4 --gpus 1` |
| Eval against held-out synthetics | `python3 -m ml.training.eval --checkpoint ml/checkpoints/last.ckpt` |
| Export to ONNX | `python3 -m ml.training.export_onnx --checkpoint ml/checkpoints/last.ckpt --out fire-spread-v0.onnx` |
| Build WebDataset shards (TODO) | `python3 -m ml.training.build_shards --shard-size 1024` |
| Fetch a fresh FIRMS slice (TODO) | `python3 -m ml.training.fetch_firms --bbox CONUS --since 30d` |

### Verified (synthetic smoke run)

```
$ python3 -m pytest ml/__tests__
====================== 44 passed in ~75s ======================
```

`test_smoke_train.py::test_loss_decreases_on_synthetic_overfit` is the
load-bearing assertion — it proves the model + loss + dataset chain
forward-passes, backprops, and updates without NaN.

### Stubbed (no real data yet)

- `WebDatasetShardDataset` — raises `NotImplementedError`. Lands when the
  data pipeline (PRD §5.4) is wired up.
- `--no-synthetic` mode in `train.py` — same.
- `fetch_firms`, `build_shards` — listed above for reference; not yet
  implemented.

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
