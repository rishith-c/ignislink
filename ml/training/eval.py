"""Evaluation entrypoint — compute per-horizon fire-front IoU.

Usage::

    python -m ml.training.eval --checkpoint ml/checkpoints/last.ckpt

Works against the synthetic dataset for now (PRD §5.4); a real held-out
evaluation against NIFC perimeters lands with the data pipeline.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from torch.utils.data import DataLoader

from ml.models.unet_convlstm import C_INPUT, HORIZONS, FireSpreadUNetConvLSTM
from ml.training.dataset import HORIZONS_MIN, SyntheticConfig, SyntheticFireDataset
from ml.training.losses import combined_loss, fire_front_iou_score


@dataclass(frozen=True)
class EvalConfig:
    checkpoint: Path
    grid: int = 64
    base_channels: int = 8
    samples: int = 8
    batch_size: int = 2
    seed: int = 137  # Held-out — different from the training seed.
    output_dir: Path = Path("ml/eval")


# ────────────────────────── Checkpoint loading ──────────────────────────


def _load_state_dict(checkpoint: Path) -> dict[str, torch.Tensor]:
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
    if isinstance(payload, dict):
        # Plain torch save with 'model_state_dict'
        if "model_state_dict" in payload:
            return payload["model_state_dict"]
        # Lightning checkpoint
        if "state_dict" in payload:
            sd = payload["state_dict"]
            # Strip the 'model.' prefix Lightning adds via FireSpreadLitModule.
            return {k.removeprefix("model."): v for k, v in sd.items() if k.startswith("model.")} or sd
    raise ValueError(f"unrecognised checkpoint format: {checkpoint}")


def _load_model(cfg: EvalConfig) -> FireSpreadUNetConvLSTM:
    model = FireSpreadUNetConvLSTM(
        in_channels=C_INPUT,
        base_channels=cfg.base_channels,
        horizons=HORIZONS,
    )
    state = _load_state_dict(cfg.checkpoint)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        print(f"[eval] missing keys (using random init): {missing}")
    if unexpected:
        print(f"[eval] unexpected keys (ignored): {unexpected}")
    model.eval()
    return model


# ────────────────────────── Metric loop ──────────────────────────


def evaluate(cfg: EvalConfig) -> dict[str, Any]:
    model = _load_model(cfg)
    ds = SyntheticFireDataset(
        n_samples=cfg.samples,
        cfg=SyntheticConfig(grid=cfg.grid, seed=cfg.seed),
    )
    loader = DataLoader(ds, batch_size=cfg.batch_size, shuffle=False)

    horizon_names = [f"{m // 60}h" if m >= 60 else f"{m}m" for m in HORIZONS_MIN[:HORIZONS]]
    iou_sums = [0.0 for _ in horizon_names]
    loss_sum = 0.0
    n_batches = 0

    with torch.no_grad():
        for x, y in loader:
            pred = model(x)
            loss_sum += float(combined_loss(pred, y).item())
            for i in range(pred.shape[1]):
                iou_sums[i] += float(
                    fire_front_iou_score(pred[:, i : i + 1], y[:, i : i + 1]).item()
                )
            n_batches += 1

    n = max(1, n_batches)
    metrics = {
        "checkpoint": str(cfg.checkpoint),
        "samples": cfg.samples,
        "grid": cfg.grid,
        "loss_mean": loss_sum / n,
        "fire_front_iou": {name: iou_sums[i] / n for i, name in enumerate(horizon_names)},
    }

    cfg.output_dir.mkdir(parents=True, exist_ok=True)
    out = cfg.output_dir / "summary.json"
    out.write_text(json.dumps(metrics, indent=2))
    print(f"[eval] wrote {out}")
    return metrics


# ────────────────────────── CLI ──────────────────────────


def parse_args(argv: list[str] | None = None) -> EvalConfig:
    p = argparse.ArgumentParser(description="Evaluate a fire-spread checkpoint.")
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--grid", type=int, default=64)
    p.add_argument("--base-channels", type=int, default=8)
    p.add_argument("--samples", type=int, default=8)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--seed", type=int, default=137)
    p.add_argument("--output-dir", type=Path, default=Path("ml/eval"))
    args = p.parse_args(argv)
    return EvalConfig(
        checkpoint=args.checkpoint,
        grid=args.grid,
        base_channels=args.base_channels,
        samples=args.samples,
        batch_size=args.batch_size,
        seed=args.seed,
        output_dir=args.output_dir,
    )


def main() -> int:
    cfg = parse_args()
    evaluate(cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
