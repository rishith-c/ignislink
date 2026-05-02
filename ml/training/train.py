"""Training entrypoint — `python -m training.train --config <yaml>`.

Stage 3 deliverable. Stub for now so the directory layout + commands in
ml/README.md resolve while the real implementation is being authored.
"""

from __future__ import annotations

import argparse


def main() -> int:
    parser = argparse.ArgumentParser(description="Train the IgnisLink fire-spread model.")
    parser.add_argument("--config", required=True, help="Path to the YAML config file.")
    parser.add_argument("--mlflow-experiment", default="fire-spread", help="MLflow experiment name.")
    parser.add_argument("--max-epochs", type=int, default=20)
    parser.add_argument("--gpus", type=int, default=0, help="GPU count (0 = CPU).")
    args = parser.parse_args()

    raise NotImplementedError(
        f"Training pipeline lands in Stage 3 (PRD §5.4). "
        f"Got --config={args.config}, --gpus={args.gpus}."
    )


if __name__ == "__main__":
    raise SystemExit(main())
