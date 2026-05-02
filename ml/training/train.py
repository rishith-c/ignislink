"""Training entrypoint — `python -m ml.training.train`.

CPU-runnable on synthetic fixtures. The same loop scales to multi-GPU by
swapping the dataset for the WebDataset shard reader and adding
`lightning.Fabric` or DDP — see PRD §5.4 for the full plan.

Smoke run:
    python -m ml.training.train --epochs 1 --grid 32 --train-samples 8
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import time
from pathlib import Path

import torch
from torch.utils.data import DataLoader

from ml.models.unet_convlstm import (
    C_INPUT,
    HORIZONS,
    FireSpreadUNetConvLSTM,
    weighted_bce_dice_iou,
)
from ml.training.dataset import SyntheticConfig, SyntheticFireDataset


@dataclasses.dataclass
class TrainConfig:
    epochs: int = 1
    batch_size: int = 2
    train_samples: int = 16
    val_samples: int = 4
    grid: int = 32
    base_channels: int = 8
    lr: float = 1e-3
    weight_decay: float = 1e-4
    seed: int = 42
    log_every: int = 1
    checkpoint_dir: str = "ml/checkpoints"
    use_mlflow: bool = False
    experiment_name: str = "fire-spread-smoke"


def _maybe_mlflow(cfg: TrainConfig):
    if not cfg.use_mlflow:
        return None
    try:
        import mlflow

        mlflow.set_experiment(cfg.experiment_name)
        mlflow.start_run()
        mlflow.log_params(dataclasses.asdict(cfg))
        return mlflow
    except ImportError:
        print("[warn] mlflow not installed — skipping tracking")
        return None


def fire_front_iou(pred: torch.Tensor, target: torch.Tensor, eps: float = 1e-6) -> float:
    """Per-batch fire-front IoU (PRD §5.4 primary metric)."""
    bin_pred = (pred > 0.5).float()
    inter = (bin_pred * target).sum()
    union = (bin_pred + target - bin_pred * target).sum()
    return float((inter / (union + eps)).item())


def train(cfg: TrainConfig) -> Path:
    torch.manual_seed(cfg.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[train] device={device}, cfg={dataclasses.asdict(cfg)}")

    train_ds = SyntheticFireDataset(
        cfg.train_samples,
        SyntheticConfig(grid=cfg.grid, seed=cfg.seed),
    )
    val_ds = SyntheticFireDataset(
        cfg.val_samples,
        SyntheticConfig(grid=cfg.grid, seed=cfg.seed + 1000),
    )
    train_loader = DataLoader(train_ds, batch_size=cfg.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=cfg.batch_size)

    model = FireSpreadUNetConvLSTM(
        in_channels=C_INPUT,
        base_channels=cfg.base_channels,
        horizons=HORIZONS,
    ).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)

    mlf = _maybe_mlflow(cfg)
    history: list[dict] = []
    start = time.time()

    for epoch in range(cfg.epochs):
        model.train()
        running = 0.0
        for step, (x, y) in enumerate(train_loader):
            x = x.to(device)
            y = y.to(device)
            pred = model(x)
            loss = weighted_bce_dice_iou(pred, y)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            running += loss.item()
            if step % cfg.log_every == 0:
                print(f"[train] epoch={epoch} step={step} loss={loss.item():.4f}")

        model.eval()
        val_loss_sum = 0.0
        val_iou_sum = 0.0
        with torch.no_grad():
            for x, y in val_loader:
                x = x.to(device)
                y = y.to(device)
                pred = model(x)
                val_loss_sum += weighted_bce_dice_iou(pred, y).item()
                val_iou_sum += fire_front_iou(pred[:, 1], y[:, 1])  # 6h horizon

        n_val_batches = max(1, len(val_loader))
        epoch_record = {
            "epoch": epoch,
            "train_loss_mean": running / max(1, len(train_loader)),
            "val_loss_mean": val_loss_sum / n_val_batches,
            "val_iou_6h": val_iou_sum / n_val_batches,
        }
        history.append(epoch_record)
        print(f"[train] epoch={epoch} summary={epoch_record}")
        if mlf is not None:
            mlf.log_metrics(
                {k: v for k, v in epoch_record.items() if isinstance(v, (int, float))},
                step=epoch,
            )

    out_dir = Path(cfg.checkpoint_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_path = out_dir / f"smoke-epoch{cfg.epochs}-{int(time.time())}.pt"
    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "config": dataclasses.asdict(cfg),
            "history": history,
            "elapsed_sec": time.time() - start,
        },
        ckpt_path,
    )
    print(f"[train] saved checkpoint to {ckpt_path}")
    if mlf is not None:
        mlf.log_artifact(str(ckpt_path))
        mlf.end_run()

    summary_path = out_dir / "last-run.json"
    summary_path.write_text(json.dumps({"checkpoint": str(ckpt_path), "history": history}, indent=2))
    return ckpt_path


def parse_args() -> TrainConfig:
    p = argparse.ArgumentParser(description="Train the IgnisLink fire-spread model.")
    p.add_argument("--epochs", type=int, default=1)
    p.add_argument("--batch-size", type=int, default=2)
    p.add_argument("--train-samples", type=int, default=16)
    p.add_argument("--val-samples", type=int, default=4)
    p.add_argument("--grid", type=int, default=32)
    p.add_argument("--base-channels", type=int, default=8)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--mlflow", action="store_true")
    args = p.parse_args()
    return TrainConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        train_samples=args.train_samples,
        val_samples=args.val_samples,
        grid=args.grid,
        base_channels=args.base_channels,
        lr=args.lr,
        use_mlflow=args.mlflow,
    )


if __name__ == "__main__":
    cfg = parse_args()
    train(cfg)
