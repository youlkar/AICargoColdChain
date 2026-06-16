FROM python:3.12-slim

WORKDIR /app

# System deps for psycopg (Postgres checkpointer) and torch
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Railway sets PORT automatically; default to 8000 for local docker runs
ENV PORT=8000

EXPOSE $PORT

CMD uvicorn backend.app:app --host 0.0.0.0 --port $PORT
