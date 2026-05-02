"""Export a trained checkpoint to ONNX (PRD §5.4 → §5.5 serving handoff).

Usage:
    python -m ml.training.export_onnx \
        --checkpoint ml/checkpoints/smoke-epoch1-XXXX.pt \
        --output ml/models/fire-spread-smoke.onnx
"""

from __future__ import annotations

import argparse
from pathlib import Path

import torch

from ml.models.unet_convlstm import C_INPUT, HORIZONS, FireSpreadUNetConvLSTM


def export(checkpoint: Path, output: Path, base_channels: int, grid: int = 64) -> Path:
    payload = torch.load(checkpoint, map_location="cpu", weights_only=True)
    cfg = payload.get("config", {})
    bc = int(cfg.get("base_channels", base_channels))
    model = FireSpreadUNetConvLSTM(in_channels=C_INPUT, base_channels=bc, horizons=HORIZONS)
    model.load_state_dict(payload["model_state_dict"])
    model.eval()

    dummy = torch.randn(1, 4, C_INPUT, grid, grid)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        str(output),
        opset_version=18,
        input_names=["input"],
        output_names=["burn_probability"],
        dynamic_axes={
            "input": {0: "batch", 3: "height", 4: "width"},
            "burn_probability": {0: "batch", 2: "height", 3: "width"},
        },
    )
    print(f"[onnx] exported {output} (size: {output.stat().st_size / 1024:.1f} KB)")
    return output


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--checkpoint", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--base-channels", type=int, default=8)
    p.add_argument("--grid", type=int, default=64)
    return p.parse_args()


if __name__ == "__main__":
    args = parse_args()
    export(args.checkpoint, args.output, args.base_channels, args.grid)
