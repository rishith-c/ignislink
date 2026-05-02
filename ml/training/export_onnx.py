"""Export a trained checkpoint to ONNX (PRD §5.4 → §5.5 serving handoff).

Usage::

    python -m ml.training.export_onnx \\
        --checkpoint ml/checkpoints/last.ckpt \\
        --out fire-spread-v0.onnx

Uses ONNX opset 17 (matches what the FastAPI inference service in
``apps/api-py`` is calibrated against). Verifies the export by loading the
file with ``onnxruntime`` and checking the outputs match the PyTorch model
within numerical tolerance.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import numpy as np
import torch

from ml.models.unet_convlstm import C_INPUT, HORIZONS, FireSpreadUNetConvLSTM


DEFAULT_OPSET: int = 17
"""ONNX opset version. Bumping this is a runtime-compat change."""


def _load_state_dict(checkpoint: Path) -> dict[str, torch.Tensor]:
    payload = torch.load(checkpoint, map_location="cpu", weights_only=False)
    if isinstance(payload, dict):
        if "model_state_dict" in payload:
            return payload["model_state_dict"]
        if "state_dict" in payload:
            sd = payload["state_dict"]
            stripped = {
                k.removeprefix("model."): v
                for k, v in sd.items()
                if k.startswith("model.")
            }
            return stripped or sd
    raise ValueError(f"unrecognised checkpoint format: {checkpoint}")


def _build_model_from_checkpoint(
    checkpoint: Path,
    *,
    base_channels: int,
) -> FireSpreadUNetConvLSTM:
    model = FireSpreadUNetConvLSTM(
        in_channels=C_INPUT,
        base_channels=base_channels,
        horizons=HORIZONS,
    )
    state = _load_state_dict(checkpoint)
    model.load_state_dict(state, strict=False)
    model.eval()
    return model


def export(
    checkpoint: Path,
    out: Path,
    *,
    base_channels: int = 8,
    grid: int = 64,
    opset: int = DEFAULT_OPSET,
    verify: bool = True,
    rtol: float = 1e-3,
    atol: float = 1e-4,
) -> Path:
    """Export ``checkpoint`` to ``out`` (ONNX); optionally verify with onnxruntime.

    Returns the path to the written file. Raises if verification fails.
    """
    model = _build_model_from_checkpoint(checkpoint, base_channels=base_channels)

    out.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 4, C_INPUT, grid, grid)
    # Round the fuel channel so the embedding-lookup input is sane.
    dummy[:, :, 5] = dummy[:, :, 5].abs().clamp(0, 40).round()

    torch.onnx.export(
        model,
        dummy,
        str(out),
        opset_version=opset,
        input_names=["input"],
        output_names=["burn_probability"],
        dynamic_axes={
            "input": {0: "batch", 3: "height", 4: "width"},
            "burn_probability": {0: "batch", 2: "height", 3: "width"},
        },
    )
    print(f"[onnx] exported {out} (size: {out.stat().st_size / 1024:.1f} KB, opset={opset})")

    if verify:
        _verify_onnx(model, out, dummy, rtol=rtol, atol=atol)
    return out


def _verify_onnx(
    model: FireSpreadUNetConvLSTM,
    out: Path,
    dummy: torch.Tensor,
    *,
    rtol: float,
    atol: float,
) -> None:
    """Load with onnxruntime and compare outputs to the PyTorch model."""
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError(
            "onnxruntime is required for verification — pip install onnxruntime"
        ) from exc

    with torch.no_grad():
        torch_out = model(dummy).numpy()

    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    onnx_out = sess.run(None, {"input": dummy.numpy()})[0]

    diff = float(np.max(np.abs(torch_out - onnx_out)))
    if not np.allclose(torch_out, onnx_out, rtol=rtol, atol=atol):
        raise RuntimeError(
            f"ONNX and PyTorch outputs disagree by max |Δ| = {diff:.4g} "
            f"(rtol={rtol}, atol={atol})"
        )
    print(f"[onnx] verified — max |Δ| vs PyTorch = {diff:.2e}")


# ────────────────────────── CLI ──────────────────────────


def parse_args(argv: list[str] | None = None) -> dict[str, Any]:
    p = argparse.ArgumentParser(description="Export a fire-spread checkpoint to ONNX.")
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--base-channels", type=int, default=8)
    p.add_argument("--grid", type=int, default=64)
    p.add_argument("--opset", type=int, default=DEFAULT_OPSET)
    p.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip the onnxruntime round-trip verification.",
    )
    args = p.parse_args(argv)
    return {
        "checkpoint": args.checkpoint,
        "out": args.out,
        "base_channels": args.base_channels,
        "grid": args.grid,
        "opset": args.opset,
        "verify": not args.no_verify,
    }


def main() -> int:
    args = parse_args()
    export(**args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
