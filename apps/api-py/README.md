# IgnisLink Python API

FastAPI service for internal ingestion, prediction orchestration, and dispatch workflows.

Stage 0 exposes only boot, health, readiness, and stub detection routes. Provider-specific
FIRMS, HRRR, LANDFIRE, and dispatch behavior begins in later PRD stages with tests first.

## Local Commands

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
uvicorn ignislink_api.main:app --reload
pytest
```
