#!/usr/bin/env bash
# deploy/cloudrun_deploy.sh
# One-command deploy to Google Cloud Run (free tier).

set -euo pipefail

PROJECT_ID="ai-cargo-cold-chain"
SERVICE_NAME="ai-cargo-backend"
REGION="us-central1"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "==> Loading env vars from .env ..."
if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in values"
  exit 1
fi

# Write a clean env-vars file for gcloud (strips comments and blank lines)
ENV_FILE=$(mktemp)
grep -v '^\s*#' .env | grep -v '^\s*$' > "${ENV_FILE}"

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
  --env-vars-file "${ENV_FILE}" \
  --project "${PROJECT_ID}"

rm -f "${ENV_FILE}"

echo ""
echo "==> Deploy complete. Service URL:"
gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format "value(status.url)"
