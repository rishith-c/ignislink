"""End-to-end smoke test for the training pipeline.

This is the **proof-of-life** test for the Stage 3 ML deliverable: it
verifies the U-Net+ConvLSTM model + combined loss + synthetic dataset +
Lightning training loop wire together and produce a measurable loss
decrease in a small number of steps. Without this, none of the other
unit tests prove the training pipeline works end-to-end.

Skipped automatically when torch is not installed.
"""

from __future__ import annotations

from pathlib import Path

import pytest

torch = pytest.importorskip("torch")  # type: ignore[assignment]
pytest.importorskip("lightning")

import lightning as L  # noqa: E402
from torch.utils.data import DataLoader  # noqa: E402

from ml.training.dataset import SyntheticConfig, SyntheticFireDataset  # noqa: E402
from ml.training.losses import combined_loss  # noqa: E402
from ml.training.train import (  # noqa: E402
    FireSpreadLitModule,
    SyntheticDataModule,
    TrainConfig,
    train,
)


@pytest.fixture()
def smoke_cfg(tmp_path: Path) -> TrainConfig:
    """Minimal config that runs in <60 s on CPU."""
    return TrainConfig(
        max_epochs=1,
        batch_size=2,
        train_samples=4,
        val_samples=2,
        grid=24,
        base_channels=4,
        lr=1e-2,
        weight_decay=1e-4,
        seed=1,
        gpus=0,
        synthetic=True,
        checkpoint_dir=str(tmp_path / "checkpoints"),
        experiment_name="smoke-test",
        # Send MLflow logs into the temp dir to keep the test hermetic.
        mlflow_tracking_uri=f"file:{tmp_path / 'mlruns'}",
    )


def test_train_runs_end_to_end_and_produces_checkpoint(smoke_cfg: TrainConfig) -> None:
    """``train(cfg)`` must complete and save a checkpoint."""
    ckpt = train(smoke_cfg)
    assert ckpt.exists(), f"checkpoint was not saved at {ckpt}"


def test_loss_decreases_on_synthetic_overfit(smoke_cfg: TrainConfig) -> None:
    """A few SGD steps on a tiny synthetic batch must reduce the combined loss.

    This is the load-bearing assertion: it proves the model parameters
    actually update, the loss is differentiable end-to-end, and there are
    no NaN/inf failure modes hidden in the loop.
    """
    L.seed_everything(smoke_cfg.seed, workers=True)

    module = FireSpreadLitModule(
        in_channels=14,
        base_channels=smoke_cfg.base_channels,
        horizons=3,
        lr=smoke_cfg.lr,
        weight_decay=smoke_cfg.weight_decay,
    )
    datamodule = SyntheticDataModule(smoke_cfg)
    datamodule.setup()
    loader = datamodule.train_dataloader()

    # Snapshot loss on the first batch before training.
    module.eval()
    x, y = next(iter(loader))
    with torch.no_grad():
        loss_before = float(combined_loss(module(x), y).item())

    # Run a handful of optimisation steps directly (skipping the Trainer
    # overhead — this test runs in well under the smoke budget).
    module.train()
    opt = module.configure_optimizers()
    for _ in range(8):
        for x, y in loader:
            opt.zero_grad()
            loss = combined_loss(module(x), y)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(module.parameters(), 1.0)
            opt.step()

    module.eval()
    with torch.no_grad():
        x, y = next(iter(loader))
        loss_after = float(combined_loss(module(x), y).item())

    assert torch.isfinite(torch.tensor(loss_after)), f"loss went to NaN/Inf: {loss_after}"
    assert loss_after < loss_before, (
        f"smoke training did not reduce loss — before={loss_before:.4f}, "
        f"after={loss_after:.4f}; the model + loss + dataset chain has a regression"
    )


def test_dataloader_yields_correct_shapes(smoke_cfg: TrainConfig) -> None:
    """Smoke check: the loader emits the (T,C,H,W) shape the model expects."""
    ds = SyntheticFireDataset(
        n_samples=2,
        cfg=SyntheticConfig(grid=smoke_cfg.grid, seed=smoke_cfg.seed),
    )
    loader = DataLoader(ds, batch_size=2)
    x, y = next(iter(loader))
    assert x.shape == (2, 4, 14, smoke_cfg.grid, smoke_cfg.grid)
    assert y.shape == (2, 3, smoke_cfg.grid, smoke_cfg.grid)
