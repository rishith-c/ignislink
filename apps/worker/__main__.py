"""Module entrypoint so ``python -m apps.worker`` works.

Adds ``apps/worker/src`` to ``sys.path`` so the source-tree layout can be run
without installing the package, then delegates to :func:`main`.
"""

from __future__ import annotations

import os
import sys


def _bootstrap_path() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "src")
    if src not in sys.path:
        sys.path.insert(0, src)


def main() -> int:
    _bootstrap_path()
    from main import main as _real_main  # noqa: PLC0415 — import after sys.path tweak

    return _real_main()


if __name__ == "__main__":
    sys.exit(main())
