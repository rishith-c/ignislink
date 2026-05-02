FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/api-py/pyproject.toml apps/api-py/README.md ./
COPY apps/api-py/src ./src

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "ignislink_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
