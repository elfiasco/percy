#!/usr/bin/env bash
#
# Push Google OAuth credentials into AWS Secrets Manager so the running
# Percy app can use them. Idempotent — safe to re-run on credential rotation.
#
# Usage:
#   ./scripts/setup_google_oauth.sh <client_id> <client_secret>
#
#   # Or interactively (reads from stdin, hidden):
#   ./scripts/setup_google_oauth.sh
#
# Requirements:
#   - AWS CLI configured with the right profile/region
#   - AWS_REGION (defaults to us-east-1)
#   - The secret `percy/google-oauth` already exists (CDK creates it)

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
SECRET_NAME="percy/google-oauth"

CLIENT_ID="${1:-}"
CLIENT_SECRET="${2:-}"

if [[ -z "$CLIENT_ID" ]]; then
  read -p   "Google OAuth client ID:     " CLIENT_ID
fi
if [[ -z "$CLIENT_SECRET" ]]; then
  read -rs -p "Google OAuth client secret: " CLIENT_SECRET
  echo
fi

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "✗ Both client_id and client_secret are required."
  exit 1
fi

# Build the JSON payload the backend expects
PAYLOAD=$(cat <<EOF
{"client_id":"$CLIENT_ID","client_secret":"$CLIENT_SECRET"}
EOF
)

# Update or create the secret
echo "→ Writing $SECRET_NAME in $REGION…"
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region "$REGION" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$PAYLOAD" \
    --region "$REGION" >/dev/null
  echo "✓ Updated existing secret."
else
  aws secretsmanager create-secret \
    --name "$SECRET_NAME" \
    --secret-string "$PAYLOAD" \
    --region "$REGION" >/dev/null
  echo "✓ Created new secret."
fi

# App Runner needs to be reminded the secret changed (it doesn't auto-reload).
echo
echo "Next:"
echo "  1. Force the App Runner studio service to redeploy so it picks up the new"
echo "     env values from Secrets Manager:"
echo
echo "       aws apprunner start-deployment \\"
echo "         --service-arn \$(aws apprunner list-services --region $REGION \\"
echo "         --query 'ServiceSummaryList[?ServiceName==\\\`percy-studio-dev\\\`].ServiceArn' \\"
echo "         --output text) --region $REGION"
echo
echo "  2. Confirm the redirect URI in Google Cloud Console matches the App Runner"
echo "     service URL exactly (it's case- and trailing-slash-sensitive):"
echo "       https://<service-id>.$REGION.awsapprunner.com/api/auth/google/callback"
echo
echo "  3. Test from the splash page → Continue with Google."
