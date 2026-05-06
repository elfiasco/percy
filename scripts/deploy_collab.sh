#!/usr/bin/env bash
#
# Deploy the Percy collab server to AWS.
#
# Two modes:
#   1. CDK stack (recommended) — runs `cdk deploy` which creates the App Runner
#      service, IAM role, ECR image, and wires it all together.
#   2. Manual ECR push — for environments without CDK, build locally, push to ECR,
#      then create the service via the AWS console using the printed image URI.
#
# Usage:
#   ./scripts/deploy_collab.sh cdk        # full CDK deploy
#   ./scripts/deploy_collab.sh image      # just build + push image
#   ./scripts/deploy_collab.sh migrate    # run the SQL migration once
#
# Requires:
#   AWS_PROFILE set (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
#   AWS_REGION (defaults to us-east-1)
#   For migrate: DATABASE_URL or the secret-resolver below

set -euo pipefail

cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-us-east-1}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REPO="percy-collab"
IMAGE_TAG="${IMAGE_TAG:-latest}"
ECR_URI="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$IMAGE_TAG"

cmd="${1:-cdk}"

case "$cmd" in
  cdk)
    echo "→ CDK deploy (creates ECR image asset + App Runner service via CFN)"
    cd infra
    cdk deploy --require-approval never
    echo
    echo "✓ Collab service deployed."
    echo
    echo "Outputs:"
    aws cloudformation describe-stacks \
      --stack-name PercyCloudDemo \
      --region "$REGION" \
      --query 'Stacks[0].Outputs[?OutputKey==`PercyCollabUrl`].OutputValue' \
      --output text
    echo
    echo "Set the studio's VITE_YJS_WS_URL to that wss:// URL and rebuild it."
    ;;

  image)
    echo "→ Building + pushing collab image to ECR ($ECR_URI)"
    aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 \
      || aws ecr create-repository --repository-name "$REPO" --region "$REGION" >/dev/null
    aws ecr get-login-password --region "$REGION" \
      | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
    docker build -t "$REPO:$IMAGE_TAG" server/collab
    docker tag "$REPO:$IMAGE_TAG" "$ECR_URI"
    docker push "$ECR_URI"
    echo
    echo "✓ Pushed $ECR_URI"
    echo "  Use this image_identifier when creating the App Runner service manually."
    ;;

  migrate)
    echo "→ Running yjs_snapshots migration"
    if [[ -z "${DATABASE_URL:-}" ]]; then
      echo "DATABASE_URL not set; resolving from Secrets Manager…"
      SECRET=$(aws secretsmanager get-secret-value \
        --secret-id "$(aws cloudformation describe-stacks \
          --stack-name PercyCloudDemo --region "$REGION" \
          --query 'Stacks[0].Outputs[?OutputKey==`PercyDbSecretArn`].OutputValue' \
          --output text)" \
        --region "$REGION" --query SecretString --output text)
      HOST=$(echo "$SECRET" | jq -r .host)
      PORT=$(echo "$SECRET" | jq -r .port)
      USER=$(echo "$SECRET" | jq -r .username)
      PASS=$(echo "$SECRET" | jq -r .password)
      export DATABASE_URL="postgres://$USER:$PASS@$HOST:$PORT/percy"
    fi
    psql "$DATABASE_URL" -f server/collab/migrations/001_yjs_snapshots.sql
    echo "✓ Migration applied."
    ;;

  *)
    echo "Usage: $0 {cdk|image|migrate}"
    exit 1
    ;;
esac
