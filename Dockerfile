FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run injects PORT at runtime (default 8080)
ENV PORT=8080

EXPOSE $PORT

CMD uvicorn backend.app:app --host 0.0.0.0 --port $PORT
