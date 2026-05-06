"""ONNX model loader + threadpool-wrapped inference.

The fire-spread model expects ``(B=1, T=4, C=14, H, W) float32`` and
returns ``(B, 3, H, W) float32`` of sigmoid burn probabilities for the
1 h / 6 h / 24 h horizons.

Inference is dispatched to ``asyncio.to_thread`` so the FastAPI event
loop remains free during the (~50–200 ms) model forward pass.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

import numpy as np

try:
    import onnxruntime as ort
except ImportError:  # pragma: no cover
    ort = None  # type: ignore[assignment]


log = logging.getLogger(__name__)


# Model channel layout (mirrors ml/models/unet_convlstm.py).
C_INPUT = 14
T_PAST = 4
HORIZONS = (60, 360, 1440)


class FireSpreadOnnx:
    """Wraps an ``onnxruntime.InferenceSession`` with an async ``infer``."""

    def __init__(self, session: Any, input_name: str, output_name: str) -> None:
        self._session = session
        self._input_name = input_name
        self._output_name = output_name

    @classmethod
    def load(cls, model_path: str | Path) -> "FireSpreadOnnx":
        if ort is None:
            raise RuntimeError("onnxruntime is not installed")
        path = Path(model_path)
        if not path.exists():
            raise FileNotFoundError(f"ONNX model not found at {path}")
        sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        inp_name = sess.get_inputs()[0].name
        out_name = sess.get_outputs()[0].name
        log.info("loaded onnx model: %s (input=%s, output=%s)", path, inp_name, out_name)
        return cls(sess, inp_name, out_name)

    def _run(self, x: np.ndarray) -> np.ndarray:
        result = self._session.run([self._output_name], {self._input_name: x})
        return np.asarray(result[0])

    async def infer(self, x: np.ndarray) -> np.ndarray:
        """Run inference off the event loop. Returns ``(B, 3, H, W)`` array."""

        return await asyncio.to_thread(self._run, x)


def synthesize_input(
    grid_size: int = 64,
    burn_radius: int = 4,
    wind_u: float = 2.0,
    wind_v: float = 0.5,
    rh: float = 0.35,
    days_dry: float = 0.6,
) -> np.ndarray:
    """Build a synthetic ``(1, 4, 14, H, W)`` input tensor.

    Used when the ``context_raster_key`` cannot be loaded from MinIO (or in
    tests). Mirrors the channel layout in ``ml/models/unet_convlstm.py``.
    """

    h = w = grid_size
    arr = np.zeros((1, T_PAST, C_INPUT, h, w), dtype=np.float32)

    # Channel 0 — current burn mask, a small disc at center.
    yy, xx = np.ogrid[:h, :w]
    cy, cx = h // 2, w // 2
    disc = ((yy - cy) ** 2 + (xx - cx) ** 2) <= (burn_radius**2)
    for t in range(T_PAST):
        arr[0, t, 0] = disc.astype(np.float32)
        arr[0, t, 1] = wind_u
        arr[0, t, 2] = wind_v
        arr[0, t, 3] = rh
        arr[0, t, 4] = 0.5  # temperature, normalized
        # ch 5 (FBFM40 index) stays 0 — model embedding handles it
        arr[0, t, 6] = 0.4  # canopy cover
        arr[0, t, 7] = 0.5  # canopy bulk density
        arr[0, t, 8] = 0.0  # slope sin
        arr[0, t, 9] = 1.0  # slope cos
        arr[0, t, 10] = 0.0  # aspect sin
        arr[0, t, 11] = 1.0  # aspect cos
        arr[0, t, 12] = days_dry
        arr[0, t, 13] = 0.1  # rothermel ROS prior
    return arr
