# Percy AWS Local Setup

This file tracks the local machine setup needed to deploy Percy into the `percy-dev` AWS account.

## Account

- AWS account email: `bensteel12@verizon.net`
- AWS account name: `percy-dev`
- Initial region: `us-east-1`

## Local Tooling Status

- [x] AWS CLI installed: `C:\Program Files\Amazon\AWSCLIV2\aws.exe`
- [x] AWS CDK installed: `C:\Users\benst\AppData\Roaming\npm\cdk.cmd`
- [x] CDK Python dependencies installed into conda env: `percy-env`
- [x] Docker Desktop installed
- [x] Docker Desktop running (Docker 29.4.1, confirmed build and health check pass)

Because this machine has a permission issue under `C:\Users\benst\AppData\Local\Temp`, use the wrapper below for CDK commands. It points CDK/JSII temp files at `infra\.tmp` and points JSII at the installed Node runtime:

```powershell
.\scripts\cdk-percy-env.cmd synth
```

## Credential Rule

Never paste AWS passwords, root credentials, access keys, secret keys, or MFA codes into chat.

Credentials should only be entered into:

- the AWS Console in the browser;
- the official AWS CLI prompt;
- the official AWS IAM Identity Center browser login page.

The assistant can run AWS/CDK commands after the local CLI is authenticated, but it does not need to know or store the password.

## Recommended Authentication Path

For the dev account, the simplest setup is:

1. Log into the AWS Console as the root account once.
2. Enable MFA on the root account.
3. Create an admin user through IAM Identity Center for local development.
4. Authenticate the local CLI with AWS IAM Identity Center.
5. Confirm access with:

```powershell
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' sts get-caller-identity
```

If IAM Identity Center feels like too much setup for the first pass, create a temporary IAM admin user with programmatic access in the `percy-dev` account and run:

```powershell
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' configure --profile percy-dev
```

Only enter the access key and secret key into that local prompt. Do not paste them into chat.

## Deploy Commands

After Docker Desktop is installed and AWS CLI authentication works:

```powershell
cd C:\Users\benst\Desktop\percy\infra
.\scripts\cdk-percy-env.cmd bootstrap --profile percy-dev
.\scripts\cdk-percy-env.cmd deploy --profile percy-dev
```

CDK will print `PercyApiUrl` after deployment.

## Live Deployment

Percy Cloud API is deployed at:

```
https://v9ghdhdczr.us-east-1.awsapprunner.com
```

Health check: `GET /api/cloud/health` → `{"status":"ok"}`
