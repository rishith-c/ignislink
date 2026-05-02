"""Round-trip test for ONNX export.

Trains a tiny model in-memory, exports to ONNX (opset 17), and asserts
``onnxruntime`` produces matching outputs to the PyTorch model.
"""

from __future__ import annotations

from pathlib import Path

import pytest

torch = pytest.importorskip("torch")  # type: ignore[assignment]
pytest.importorskip("onnx")
pytest.importorskip("onnxruntime")

from ml.models.unet_convlstm import C_INPUT, FireSpreadUNetConvLSTM  # noqa: E402
from ml.training.export_onnx import DEFAULT_OPSET, export  # noqa: E402


def test_onnx_export_roundtrip_matches_pytorch(tmp_path: Path) -> None:
    """Train-free export of a randomly-initialised model must round-trip."""
    torch.manual_seed(0)
    model = FireSpreadUNetConvLSTM(in_channels=C_INPUT, base_channels=4, horizons=3)
    model.eval()

    # Save as a plain torch checkpoint so export() can load it back.
    ckpt_path = tmp_path / "tiny.pt"
    torch.save({"model_state_dict": model.state_dict()}, ckpt_path)

    out_path = tmp_path / "tiny.onnx"
    result = export(
        ckpt_path,
        out_path,
        base_channels=4,
        grid=24,
        opset=DEFAULT_OPSET,
        verify=True,  # raises on mismatch
    )
    assert result == out_path
    assert out_path.exists()
    assert out_path.stat().st_size > 1024  # non-trivial size
