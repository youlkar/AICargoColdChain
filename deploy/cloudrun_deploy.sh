#!/usr/bin/env bash
# deploy/cloudrun_deploy.sh
# One-command deploy to Google Cloud Run (free tier).
#
# Prerequisites:
#   - gcloud CLI installed and authenticated: gcloud auth login
#   - Project set: gcloud config set project ai-cargo-cold-chain
#   - APIs enabled (run once):
#     gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com
#   - .env file present at project root with real values
#
# Usage (from project root): bash deploy/cloudrun_deploy.sh

set -euo pipefail

PROJECT_ID="ai-cargo-cold-chain"
SERVICE_NAME="ai-cargo-backend"
REGION="us-central1"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> Loading env vars from .env ..."
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in values."
  exit 1
fi

# Build comma-separated KEY=VALUE string from .env (skip comments and blank lines)
ENV_VARS=$(grep -v '^\s*#' .env | grep -v '^\s*$' | tr '\n' ',' | sed 's/,$//')

echo "==> Building image with Cloud Build ..."
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT_ID}"

echo "==> Deploying to Cloud Run ..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "${ENV_VARS}" \
  --project "${PROJECT_ID}"

echo ""
echo "==> Deploy complete. Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)"
