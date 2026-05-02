"""Pytest configuration for the ml/ package.

Adds two custom marks:
- ``gpu``: skipped automatically if torch.cuda.is_available() is False.
- ``slow``: skipped by default; opt in with ``pytest -m slow``.
"""

from __future__ import annotations

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "gpu: requires CUDA; auto-skipped on CPU-only hosts")
    config.addinivalue_line("markers", "slow: long-running; opt in with -m slow")


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    cuda_available = _cuda_available()
    skip_slow = pytest.mark.skip(reason="slow tests skipped by default; use -m slow to enable")
    skip_gpu = pytest.mark.skip(reason="CUDA not available")

    selected_marks = config.getoption("-m") or ""

    for item in items:
        if "slow" in item.keywords and "slow" not in selected_marks:
            item.add_marker(skip_slow)
        if "gpu" in item.keywords and not cuda_available:
            item.add_marker(skip_gpu)


def _cuda_available() -> bool:
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())
