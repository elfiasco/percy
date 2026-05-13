# Percy — AWS Account Setup Guide

End-to-end setup for deploying Percy to a fresh AWS account. Takes
~45 minutes the first time, mostly waiting on Bedrock model approvals
and the initial CDK deploy.

Two infrastructure pieces:

1. **CDK stack** (`infra/`) — App Runner services + RDS Postgres + ECS
   worker + SQS + S3 + IAM + Secrets Manager + Lambdas. One command:
   `cdk deploy`.
2. **Collab service** (`server/collab/`) — separate WebSocket relay on
   AWS Lightsail Containers, because App Runner's Envoy returns 403 on
   every `wss://` upgrade regardless of egress config. Five-minute
   manual setup.

---

## 1. Prerequisites

On your workstation:

| Tool | Version | Install |
|---|---|---|
| Python | 3.13+ | `pyenv install 3.13` or system pkg |
| Node.js | 22+ | nvm: `nvm install 22` |
| Docker Desktop | latest | https://docker.com (must be running) |
| AWS CLI | v2 | `winget install Amazon.AWSCLI` / `brew install awscli` |
| AWS CDK CLI | 2.x | `npm install -g aws-cdk` |
| jq | any | for the verification curls below |

Verify each:

```bash
python --version    # 3.13.x
node --version      # v22.x
docker info         # daemon must be running
aws --version       # aws-cli/2.x
cdk --version       # 2.x
```

---

## 2. AWS account prep

### 2a. Create an AWS named profile

This guide assumes a profile called `percy-prod` (rename to whatever
you like and substitute below).

```bash
aws configure --profile percy-prod
# AWS Access Key ID: (from IAM user with AdministratorAccess for first deploy)
# AWS Secret Access Key:
# Default region: us-east-1
# Default output format: json
```

Verify:

```bash
aws sts get-caller-identity --profile percy-prod
# → Account: 123456789012, Arn: arn:aws:iam::...
```

> **Region**: `us-east-1` is recommended because that's where Bedrock
> cross-region inference profiles for Claude land. Other regions work
> for App Runner but Bedrock model availability varies.

### 2b. Enable Bedrock models

Percy uses Bedrock cross-region inference profiles for Claude. You
must explicitly request access to each model in the Bedrock console
before the deploy works.

1. AWS Console → Bedrock → **Model access** (left nav)
2. Click **Manage model access**
3. Request access to (at minimum):
   - Anthropic **Claude Sonnet 4.6** (`us.anthropic.claude-sonnet-4-6`)
   - Anthropic **Claude Opus 4.5** (`us.anthropic.claude-opus-4-5-20251101-v1:0`) — used by the demo runner
   - Anthropic **Claude 3.5 Haiku** (`us.anthropic.claude-3-5-haiku-20241022-v1:0`) — used by some smaller tasks
4. Submit and wait for approval (usually instant for Anthropic models).

Verify:

```bash
aws bedrock list-inference-profiles --region us-east-1 --profile percy-prod \
  --query 'inferenceProfileSummaries[?contains(id, `claude`)].id' --output json
# → should list claude-sonnet-4-6, claude-opus-4-5-..., etc.
```

If a model returns `ValidationException: model not enabled`, the access
request hasn't been approved yet.

---

## 3. One-time secrets

CDK references these Secrets Manager entries by name. They must exist
**before** the first deploy or `cdk synth` errors out.

```bash
# Anthropic — direct API fallback (Bedrock is primary; this is a backup)
# Get a key at https://console.anthropic.com/settings/keys
aws secretsmanager create-secret \
  --name percy/anthropic-api-key \
  --secret-string '{"api_key":"sk-ant-..."}' \
  --profile percy-prod --region us-east-1

# OpenAI — used by the Coder skill (Codex)
# Get a key at https://platform.openai.com/api-keys
aws secretsmanager create-secret \
  --name percy/openai-api-key \
  --secret-string '{"api_key":"sk-..."}' \
  --profile percy-prod --region us-east-1

# Google OAuth — required for "Sign in with Google" (optional)
# Create OAuth client at https://console.cloud.google.com/apis/credentials
#   - Application type: Web application
#   - Authorized redirect URI: leave for now, you'll fix it after first deploy
aws secretsmanager create-secret \
  --name percy/google-oauth \
  --secret-string '{"client_id":"...apps.googleusercontent.com","client_secret":"..."}' \
  --profile percy-prod --region us-east-1
```

Don't worry about the **JWT signing secret** — CDK auto-generates it
on first deploy and rotates safely.

---

## 4. CDK bootstrap

Each AWS account needs CDK's "bootstrap stack" once before any
`cdk deploy`:

```bash
cd infra
cdk bootstrap aws://$(aws sts get-caller-identity --profile percy-prod --query Account --output text)/us-east-1 \
  --profile percy-prod
```

Creates the `CDKToolkit` stack with an S3 bucket + ECR repo + IAM
roles CDK uses to publish assets.

---

## 5. First deploy

```bash
cd infra
cdk deploy --profile percy-prod --require-approval never
```

Expected runtime: **8–10 minutes**. Watch for:

1. **Synthesis** (~20s) — Python compiles to CloudFormation
2. **Image builds + pushes** (~2–3 min each):
   - PercyCloudApiImage
   - PercyStudioImage (slowest — frontend `npm install` + `vite build`)
   - PercyWorkerImage
3. **Stack create** (~5 min) — VPC, RDS, App Runner services come up

On success, CDK prints stack outputs at the bottom:

```
PercyCloudDemoStack.PercyApiUrl       = https://<random>.us-east-1.awsapprunner.com
PercyCloudDemoStack.PercyStudioUrl    = https://<random>.us-east-1.awsapprunner.com
PercyCloudDemoStack.PercyCollabUrl    = wss://<random>.us-east-1.awsapprunner.com  ← unused; we use Lightsail instead
PercyCloudDemoStack.PercyDbSecretArn  = arn:aws:secretsmanager:...
PercyCloudDemoStack.PercyArtifactsBucket = ...
PercyCloudDemoStack.PercyOnboardQueueUrl = https://sqs....
```

**Save the `PercyStudioUrl`** — you'll wire it back into the stack in
the next step.

---

## 6. Post-deploy fixups (one-time)

The stack hardcodes two URLs that need to point at your account's
auto-assigned Studio hostname:

1. `infra/percy_stack.py` line 402 — `VITE_YJS_WS_URL` (Lightsail WS)
2. `infra/percy_stack.py` lines ~531, ~1227 — Google OAuth callback +
   STUDIO_URL referenced from the cloud-api spend monitor and refresh
   scheduler Lambdas

Open `infra/percy_stack.py` in your editor:

```python
# Around line 531 — Google OAuth callback
value="https://36kuepamyi.us-east-1.awsapprunner.com/api/auth/google/callback",
```

Replace `36kuepamyi.us-east-1.awsapprunner.com` with your Studio
hostname (from the `PercyStudioUrl` output). Same for the other
occurrences:

```bash
grep -rn "36kuepamyi" infra/percy_stack.py
```

Then redeploy:

```bash
cd infra
cdk deploy --profile percy-prod --require-approval never
```

This second deploy is fast (~3 min) — only the changed env vars get
applied.

### 6a. Update Google OAuth client redirect URI

If you set up Google OAuth in step 3:

1. https://console.cloud.google.com/apis/credentials → your OAuth client
2. Authorized redirect URIs → add:
   `https://<your-studio-hostname>/api/auth/google/callback`
3. Save

---

## 7. Collab service (AWS Lightsail Containers)

The WebSocket relay for real-time multi-user collab runs on Lightsail
because App Runner's load balancer returns 403 on `wss://` upgrades.
It's a separate one-time setup.

### 7a. Provision a Lightsail Container service

AWS Console → Lightsail → **Containers** → Create container service:

- Region: same as your CDK stack (us-east-1)
- Capacity: **Nano (512 MB / 0.25 vCPU, $7/mo)**
- Service name: `percy-collab`
- Skip the "set up first deployment" step (we'll push from CLI)

### 7b. Build + push the collab image

```bash
cd server/collab
# Lightsail accepts Docker images directly via aws lightsail push-container-image
aws lightsail push-container-image \
  --service-name percy-collab \
  --label collab \
  --image $(docker build -q .) \
  --region us-east-1 --profile percy-prod
# → outputs an image reference like ":percy-collab.collab.1"
```

### 7c. Deploy the container

In the Lightsail console for `percy-collab`:

1. **Deployments** → Create new deployment
2. Container name: `collab`
3. Image: paste the `:percy-collab.collab.X` reference from step 7b
4. Open ports: `3000 / HTTP`
5. Public endpoint: `collab`, port `3000`, health check path `/`
6. Save and deploy. Takes ~3 minutes.

Lightsail assigns a hostname like:
`https://percy-collab.16m6vj1w4md2c.us-east-1.cs.amazonlightsail.com`.

### 7d. Wire the collab URL into the studio

Update `infra/percy_stack.py` around line 402:

```python
"VITE_YJS_WS_URL": "wss://<your-lightsail-hostname>",
```

Redeploy CDK:

```bash
cd infra && cdk deploy --profile percy-prod --require-approval never
```

(This rebuilds the studio frontend bundle with the new WS URL baked in.)

---

## 8. Verification

```bash
STUDIO_URL=https://<your-studio-hostname>

# Backend up?
curl -s $STUDIO_URL/api/health | jq .
# → {"ok": true, ...}

# Build SHA matches your local commit?
curl -s $STUDIO_URL/api/version | jq .
# → {"git_sha": "<short-sha>", "build_time": "..."}

# Demo brands seeded?
curl -s $STUDIO_URL/api/showcase | jq '.brands[].slug'
# → "percy_standard"
# → "snowflake"

# Splash renders?
# Open $STUDIO_URL in a browser. Scroll down past the hero.
# You should see "One brief. Two agents. Completely different decks."
# with two button tabs (Percy Standard, Snowflake) and a 7-slide deck
# per brand.
```

---

## 9. What got deployed (cost-wise)

| Service | Class | $/mo (us-east-1, idle) | $/mo (active) |
|---|---|---|---|
| App Runner — PercyCloudApi | 0.25 vCPU / 0.5 GB | ~$5 | up to $30 |
| App Runner — PercyStudio | 0.25 vCPU / 0.5 GB | ~$5 | up to $30 |
| RDS — db.t4g.micro | 20 GB gp3 | ~$13 | ~$13 |
| ECS Fargate — OnboardWorker | 0.5 vCPU / 1 GB | $0 (scale-to-zero) | ~$15/onboard |
| S3 — `percy-artifacts` | per GB | <$1 | varies |
| Lightsail Containers — collab | Nano | $7 | $7 |
| Lambdas (refresh, spend monitor) | per invoke | <$1 | <$1 |
| Bedrock — Claude calls | per token | $0 | varies — biggest variable |
| SQS, CloudWatch, Secrets Manager | small | ~$2 | ~$5 |

**Baseline: ~$35/mo idle.** Bedrock is the variable — Opus 4.5 demo
runs cost ~$0.50 each; agent slide generation runs $0.05-$0.30 per
deck depending on size.

A `$200/mo` kill-switch Lambda is included (`PercySpendMonitor`) —
fires SNS alerts at $20 increments and halts non-essential services
if monthly bill projection exceeds $200. Email subscribers default to
the addresses listed at the top of `percy_stack.py:DEFAULT_ALERT_EMAILS`
— edit before deploying or pass `--context alert_emails=a@x.com,b@y.com`.

---

## 10. Common tweaks

### Custom domain instead of `*.awsapprunner.com`

App Runner supports custom domains via console:
1. App Runner → your `PercyStudio` service → **Custom domains**
2. Link `studio.yourdomain.com` and follow DNS validation
3. Update the OAuth callback URI in the stack + Google Cloud console

### Stripping out the demo brands

The persistent demo decks (`demo_brands/*.json` + `*.demo.json`) get
seeded on every boot. To start with a clean account, delete the files
before deploying:

```bash
rm demo_brands/*.json demo_brands/*.demo.json
```

The splash will show an empty "no demos yet" state.

### Different region

Change `region` in `cdk.json` (or pass `--context region=...`). Note:
Bedrock cross-region inference profiles still route through us-east-1,
us-west-2, us-east-2 — App Runner / RDS / ECS can be anywhere.

---

## 11. Tearing it down

```bash
cd infra
cdk destroy --profile percy-prod --force
```

Deletes everything **except**:
- The RDS snapshot (taken on destroy by default — set
  `removal_policy=DESTROY` and `deletion_protection=False` in
  `percy_stack.py` to skip; they're already set that way for dev)
- The S3 `percy-artifacts` bucket (CDK can't delete non-empty buckets;
  empty it first with `aws s3 rm s3://<bucket> --recursive`)
- The Secrets Manager entries you created in step 3 (delete manually
  with `aws secretsmanager delete-secret --name percy/...`)
- The Lightsail collab service (delete from the Lightsail console)
- The CDK bootstrap stack (only delete if you're not using CDK in
  this account at all anymore: `aws cloudformation delete-stack
  --stack-name CDKToolkit`)

---

## 12. Migrating from another AWS account

If you're moving from an existing Percy deployment:

1. Export your existing RDS data:
   ```bash
   pg_dump -h <old-rds-host> -U percy -d percy -F c -f percy.dump
   ```
2. Run steps 1–6 on the new account.
3. Restore the dump:
   ```bash
   pg_restore -h <new-rds-host> -U percy -d percy --clean --if-exists percy.dump
   ```
4. Copy your S3 artifacts bucket contents:
   ```bash
   aws s3 sync s3://<old-artifacts-bucket> s3://<new-artifacts-bucket> \
     --source-region us-east-1 --region us-east-1
   ```
5. Re-create the Lightsail collab service (step 7) — there's no
   migration path; the new container is the source of truth from then on.
6. Re-create your Secrets Manager entries on the new account (they're
   account-scoped).

User session JWTs are signed with the new account's auto-generated
`percy/jwt-secret`, so everyone has to log in again on the new host.
That's expected.

---

## Troubleshooting

| Symptom | Cause + fix |
|---|---|
| `cdk deploy` fails with `ENOENT: lstat …-shm` | SQLite WAL race during asset staging. `infra/percy_stack.py` already excludes the dev SQLite siblings; if a stray DB sits at the repo root, just delete it or wait a few seconds and retry. |
| `model not enabled` on first Bedrock call | Step 2b — request access to the specific model in the Bedrock console. |
| Studio loads but the splash deck section is empty | Demo seeding ran on a fresh DB but `demo_brands/*.demo.json` snapshots aren't in the deployed image. Check that `COPY demo_brands /app/demo_brands` is in `Dockerfile.studio` and re-deploy. |
| `Google sign-in not configured` on the login page | `percy/google-oauth` secret missing or callback URI not added in Google Cloud console (step 6a). Email/password auth still works without this. |
| `wss://` connection fails in browser console | Collab service down or Lightsail hostname stale. Hit `https://<lightsail-host>/health` directly; if it 404s, redeploy the container (step 7c). |
| `cdk deploy` fails with `Tags.of(...) forces replacement` | App Runner / Lightsail VpcConnectors can't be tag-rotated without replacement, and replacement fails on naming conflicts. Don't enable `Tags.of(self).add()` at stack level (the stack already avoids this). |

---

## Reference: stack outputs

After deploy you can always re-fetch the URLs:

```bash
aws cloudformation describe-stacks \
  --stack-name PercyCloudDemoStack \
  --profile percy-prod --region us-east-1 \
  --query 'Stacks[0].Outputs' --output table
```
