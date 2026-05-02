"""Lightning-driven training entrypoint — PRD §5.4.

CPU-runnable on the synthetic dataset (default). The same loop scales to
multi-GPU by setting ``--gpus N`` and (later) swapping the synthetic dataset
for the WebDataset shard reader.

Smoke run::

    python -m ml.training.train --synthetic --max-epochs 2

The smoke run trains for 2 epochs on 32 synthetic samples with batch=2,
proving the architecture forward-passes, backprops, and updates without
NaN. It is the primary proof-of-life test for the model + loss + dataset
chain (PRD §5.3 + §5.4).
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import time
from pathlib import Path
from typing import Any

import lightning as L
import torch
import torch.nn as nn
from lightning.pytorch.callbacks import ModelCheckpoint
from lightning.pytorch.loggers import MLFlowLogger
from torch.utils.data import DataLoader

from ml.models.unet_convlstm import (
    C_INPUT,
    HORIZONS,
    FireSpreadUNetConvLSTM,
)
from ml.training.dataset import SyntheticConfig, SyntheticFireDataset
from ml.training.losses import combined_loss, fire_front_iou_score


# ────────────────────────── Config ──────────────────────────


@dataclasses.dataclass
class TrainConfig:
    """Hyperparameters for a training run.

    These are populated from CLI args + ``--config`` YAML; the dataclass
    keeps everything in one place for MLflow logging.
    """

    max_epochs: int = 2
    batch_size: int = 2
    train_samples: int = 32
    val_samples: int = 8
    grid: int = 64
    base_channels: int = 8
    lr: float = 1e-3
    weight_decay: float = 1e-4
    seed: int = 42
    gpus: int = 0
    synthetic: bool = True
    checkpoint_dir: str = "ml/checkpoints"
    experiment_name: str = "fire-spread-smoke"
    mlflow_tracking_uri: str | None = None


# ────────────────────────── Lightning module ──────────────────────────


class FireSpreadLitModule(L.LightningModule):
    """Lightning wrapper around the U-Net+ConvLSTM model + combined loss."""

    def __init__(
        self,
        *,
        in_channels: int = C_INPUT,
        base_channels: int = 8,
        horizons: int = HORIZONS,
        lr: float = 1e-3,
        weight_decay: float = 1e-4,
        loss_alpha: float = 1.0,
        loss_beta: float = 0.5,
        loss_gamma: float = 0.3,
    ) -> None:
        super().__init__()
        self.save_hyperparameters()
        self.model: nn.Module = FireSpreadUNetConvLSTM(
            in_channels=in_channels,
            base_channels=base_channels,
            horizons=horizons,
        )
        self.lr = lr
        self.weight_decay = weight_decay
        self.alpha = loss_alpha
        self.beta = loss_beta
        self.gamma = loss_gamma

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)

    def _shared_step(self, batch: tuple[torch.Tensor, torch.Tensor], stage: str) -> torch.Tensor:
        x, y = batch
        pred = self(x)
        loss = combined_loss(
            pred,
            y,
            alpha=self.alpha,
            beta=self.beta,
            gamma=self.gamma,
        )

        # Per-horizon fire-front IoU.
        per_horizon_iou: dict[str, float] = {}
        for i, name in enumerate(("1h", "6h", "24h")[:pred.shape[1]]):
            iou = fire_front_iou_score(pred[:, i : i + 1], y[:, i : i + 1])
            per_horizon_iou[f"{stage}_iou_{name}"] = float(iou.item())

        log_kwargs: dict[str, Any] = {
            "on_step": stage == "train",
            "on_epoch": True,
            "prog_bar": stage == "train",
            "batch_size": x.shape[0],
        }
        self.log(f"{stage}_loss", loss, **log_kwargs)
        for k, v in per_horizon_iou.items():
            self.log(k, v, **log_kwargs)
        return loss

    def training_step(self, batch: tuple[torch.Tensor, torch.Tensor], batch_idx: int) -> torch.Tensor:
        return self._shared_step(batch, "train")

    def validation_step(self, batch: tuple[torch.Tensor, torch.Tensor], batch_idx: int) -> torch.Tensor:
        return self._shared_step(batch, "val")

    def configure_optimizers(self) -> torch.optim.Optimizer:
        return torch.optim.AdamW(
            self.parameters(),
            lr=self.lr,
            weight_decay=self.weight_decay,
        )


# ────────────────────────── Datamodule ──────────────────────────


class SyntheticDataModule(L.LightningDataModule):
    def __init__(self, cfg: TrainConfig) -> None:
        super().__init__()
        self.cfg = cfg

    def setup(self, stage: str | None = None) -> None:
        c = self.cfg
        self.train_ds = SyntheticFireDataset(
            n_samples=c.train_samples,
            cfg=SyntheticConfig(grid=c.grid, seed=c.seed),
        )
        self.val_ds = SyntheticFireDataset(
            n_samples=c.val_samples,
            cfg=SyntheticConfig(grid=c.grid, seed=c.seed + 1000),
        )

    def train_dataloader(self) -> DataLoader:
        return DataLoader(
            self.train_ds,
            batch_size=self.cfg.batch_size,
            shuffle=True,
            num_workers=0,
        )

    def val_dataloader(self) -> DataLoader:
        return DataLoader(
            self.val_ds,
            batch_size=self.cfg.batch_size,
            num_workers=0,
        )


# ────────────────────────── MLflow integration ──────────────────────────


def _build_mlflow_logger(cfg: TrainConfig) -> MLFlowLogger | None:
    """Return an MLFlowLogger wired to ``MLFLOW_TRACKING_URI`` (or file store)."""
    tracking_uri = cfg.mlflow_tracking_uri or os.environ.get("MLFLOW_TRACKING_URI")
    if not tracking_uri:
        # File-store fallback so MLflow logs land somewhere even without a server.
        Path("ml/.mlruns").mkdir(parents=True, exist_ok=True)
        tracking_uri = "file:" + str(Path("ml/.mlruns").resolve())
    try:
        logger = MLFlowLogger(
            experiment_name=cfg.experiment_name,
            tracking_uri=tracking_uri,
        )
        return logger
    except Exception as exc:  # pragma: no cover — diagnostic
        print(f"[mlflow] disabled — {exc}")
        return None


# ────────────────────────── Trainer entrypoint ──────────────────────────


def train(cfg: TrainConfig) -> Path:
    L.seed_everything(cfg.seed, workers=True)

    module = FireSpreadLitModule(
        in_channels=C_INPUT,
        base_channels=cfg.base_channels,
        horizons=HORIZONS,
        lr=cfg.lr,
        weight_decay=cfg.weight_decay,
    )
    if cfg.synthetic:
        datamodule = SyntheticDataModule(cfg)
    else:
        raise NotImplementedError(
            "Real-data training requires the WebDataset reader (PRD §5.4); "
            "use --synthetic for the smoke test."
        )

    ckpt_dir = Path(cfg.checkpoint_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    ckpt_callback = ModelCheckpoint(
        dirpath=ckpt_dir,
        filename="fire-spread-smoke-{epoch:02d}-{val_loss:.3f}",
        monitor="val_loss",
        mode="min",
        save_top_k=1,
        save_last=True,
    )

    logger = _build_mlflow_logger(cfg)

    accelerator = "cpu" if cfg.gpus == 0 else "gpu"
    devices = "auto" if cfg.gpus == 0 else cfg.gpus

    trainer = L.Trainer(
        max_epochs=cfg.max_epochs,
        accelerator=accelerator,
        devices=devices,
        logger=logger if logger is not None else False,
        callbacks=[ckpt_callback],
        log_every_n_steps=1,
        enable_progress_bar=False,
        gradient_clip_val=1.0,
        deterministic=True,
    )

    start = time.time()
    trainer.fit(module, datamodule=datamodule)
    elapsed = time.time() - start

    last_ckpt = Path(ckpt_callback.best_model_path or ckpt_callback.last_model_path)
    summary = {
        "checkpoint": str(last_ckpt),
        "elapsed_sec": elapsed,
        "config": dataclasses.asdict(cfg),
    }
    (ckpt_dir / "last-run.json").write_text(json.dumps(summary, indent=2))
    print(f"[train] done in {elapsed:.1f}s; checkpoint -> {last_ckpt}")
    return last_ckpt


# ────────────────────────── CLI ──────────────────────────


def _parse_yaml_config(path: str) -> dict[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise SystemExit(
            "yaml is required to load --config files; pip install pyyaml or pass CLI flags directly"
        ) from exc
    with open(path) as f:
        return yaml.safe_load(f) or {}


def parse_args(argv: list[str] | None = None) -> TrainConfig:
    p = argparse.ArgumentParser(description="Train the IgnisLink fire-spread model.")
    p.add_argument("--config", type=str, default=None, help="Optional YAML config file.")
    p.add_argument("--max-epochs", type=int, default=2)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--train-samples", type=int, default=32)
    p.add_argument("--val-samples", type=int, default=8)
    p.add_argument("--grid", type=int, default=64)
    p.add_argument("--base-channels", type=int, default=8)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--weight-decay", type=float, default=1e-4)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--gpus", type=int, default=0, help="GPU count (0 = CPU).")
    p.add_argument(
        "--synthetic",
        action="store_true",
        default=True,
        help="Train on the synthetic dataset (default true).",
    )
    p.add_argument("--no-synthetic", dest="synthetic", action="store_false")
    p.add_argument("--checkpoint-dir", type=str, default="ml/checkpoints")
    p.add_argument("--experiment-name", type=str, default="fire-spread-smoke")
    p.add_argument("--mlflow-tracking-uri", type=str, default=None)
    args = p.parse_args(argv)

    overrides: dict[str, Any] = {}
    if args.config:
        overrides = _parse_yaml_config(args.config)

    cfg_kwargs: dict[str, Any] = {
        "max_epochs": args.max_epochs,
        "batch_size": args.batch_size,
        "train_samples": args.train_samples,
        "val_samples": args.val_samples,
        "grid": args.grid,
        "base_channels": args.base_channels,
        "lr": args.lr,
        "weight_decay": args.weight_decay,
        "seed": args.seed,
        "gpus": args.gpus,
        "synthetic": args.synthetic,
        "checkpoint_dir": args.checkpoint_dir,
        "experiment_name": args.experiment_name,
        "mlflow_tracking_uri": args.mlflow_tracking_uri,
    }
    cfg_kwargs.update(overrides)
    return TrainConfig(**cfg_kwargs)


def main() -> int:
    cfg = parse_args()
    train(cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
