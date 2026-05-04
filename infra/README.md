# Percy AWS Infra

This CDK app deploys the first Percy cloud API demo to AWS App Runner.

The first deployment is intentionally minimal:

- containerized `app.cloud.main:app`;
- App Runner HTTPS endpoint;
- CloudWatch logs;
- no Postgres yet;
- no S3 artifacts yet;
- no SQS workers yet.

The API currently uses in-memory storage, so this deployment is for proving hosting only. Data will reset when the service restarts.

## Prerequisites

- AWS account
- AWS CLI authenticated locally
- Docker Desktop running
- Node.js
- AWS CDK CLI
- Python 3.11+

On this Windows machine, AWS CLI and CDK are currently callable through:

```powershell
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' --version
& 'C:\Users\benst\AppData\Roaming\npm\cdk.cmd' --version
```

PowerShell blocks the generated `cdk.ps1` shim, so use `cdk.cmd`.

This machine also has a temp-folder permission issue under the default user temp directory. Use the repo wrapper for CDK commands; it writes temp files into `infra\.tmp`:

```powershell
.\scripts\cdk-percy-env.cmd synth
```

## Deploy

```powershell
cd infra
.\scripts\cdk-percy-env.cmd bootstrap
.\scripts\cdk-percy-env.cmd deploy
```

If using a named profile:

```powershell
.\scripts\cdk-percy-env.cmd bootstrap --profile percy-dev
.\scripts\cdk-percy-env.cmd deploy --profile percy-dev
```

After deploy, CDK prints `PercyApiUrl`. Test:

```powershell
curl https://YOUR_APP_RUNNER_URL/api/cloud/health
```

Expected:

```json
{"status":"ok"}
```

## Destroy

```powershell
cd infra
.\.venv\Scripts\activate
cdk destroy
```
