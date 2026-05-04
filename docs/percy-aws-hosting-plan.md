# Percy AWS Hosting Plan

Percy should start on AWS with a simple hosted SaaS architecture that can later support customer-private workers and single-tenant deployments.

The key architectural principle remains:

- Percy Cloud owns identity, collaboration, versioning, governance, and orchestration.
- Execution is pluggable across Percy-hosted workers, customer-private workers, and local desktop workers.

## Initial AWS Stack

### Web And API

- **CloudFront** for frontend delivery and caching.
- **S3** for static Studio web assets.
- **ECS Fargate** or **App Runner** for the FastAPI control-plane API.
- **Application Load Balancer** if using ECS services.
- **Route 53** for DNS.
- **ACM** for TLS certificates.

Start with App Runner or ECS Fargate. App Runner is simpler; ECS Fargate gives more control once workers and networking get complex.

### Database

- **RDS Postgres** for organizations, users, teams, projects, memberships, documents, Bridge versions, jobs, audit events, approvals, snippets, and metadata.

Postgres should be the primary system of record.

### Object Storage

- **S3** for uploaded source artifacts, Bridge bundles, rendered images, exports, thumbnails, job outputs, and temporary artifacts.
- **S3 lifecycle policies** for temporary renders and old artifacts.
- **S3 object versioning** for important customer artifacts where appropriate.

### Jobs And Workers

- **SQS** for job queues.
- **ECS Fargate worker services** for Python jobs, onboarding, Bridge rebuilds, and exports.
- **Dedicated Windows worker** path for PowerPoint-dependent rendering, likely EC2 Windows initially.
- **EventBridge Scheduler** for recurring refresh jobs.

Initial queue types:

- `onboard-document`
- `render-preview`
- `rebuild-document`
- `run-python-snippet`
- `export-artifact`
- `security-scan`

### Secrets

- **AWS Secrets Manager** for data credentials, customer OAuth tokens, API keys, and service credentials.
- **KMS** for encryption keys.

Secrets must be granted to jobs explicitly. A Python job should not receive broad organization secrets by default.

### Auth And SSO

Short-term options:

1. **Amazon Cognito** for AWS-native user pools, OIDC, and SAML federation.
2. **WorkOS/Auth0** for faster enterprise SSO/SCIM setup, while still hosting Percy app infrastructure on AWS.

Recommended path:

- Start with an auth abstraction in Percy.
- Use Cognito if we want AWS-native simplicity and lower external vendor dependence.
- Use WorkOS/Auth0 if enterprise SSO onboarding speed becomes more important than AWS-native purity.

Percy should store app-specific organization membership, teams, roles, and access policy in Postgres regardless of auth provider.

### Authorization

V1:

- App-level RBAC in Postgres.
- Organization owners approve access requests.
- Team and project roles inherit downward where practical.
- Audit every access change.

Later:

- Evaluate **Amazon Verified Permissions** for fine-grained RBAC/ABAC when policy complexity justifies it.

### Search And Memory

V1:

- Postgres full-text search for projects, documents, components, and metadata.

Later:

- OpenSearch or a vector store for semantic search over slides, components, snippets, template memory, and AI retrieval.

### Observability

- **CloudWatch Logs** for API and worker logs.
- **CloudWatch Metrics** for queue depth, job duration, job failures, render timings, storage usage, and API health.
- **AWS X-Ray** or OpenTelemetry-compatible tracing later.

### Security Baseline

- Private subnets for API, workers, and database where possible.
- Public access only through CloudFront/ALB.
- S3 buckets private by default.
- Presigned URLs for controlled artifact access.
- KMS encryption at rest.
- TLS everywhere.
- Least-privilege IAM roles per service and worker type.
- Audit events written at application level.
- File scanning pipeline for uploads.
- Sandboxed Python execution.

## Deployment Models

### 1. Percy SaaS

The default hosted option.

Good for:

- early customers;
- internal teams;
- less regulated workflows;
- fast iteration.

### 2. Single-Tenant Percy Cloud

Dedicated AWS resources per enterprise customer.

Good for:

- larger customers;
- stronger isolation needs;
- custom networking;
- enterprise procurement.

### 3. Customer-Private Workers

Percy Cloud orchestrates jobs, but customer infrastructure runs sensitive jobs.

Good for:

- private warehouses;
- regulated data;
- private Python packages;
- no data egress policies.

Worker model:

- customer installs Percy Worker Agent;
- worker pulls jobs from Percy Cloud;
- customer secrets remain local;
- policy controls what outputs can be returned to Percy Cloud.

### 4. Full Private Deployment

Only for later, if large regulated customers require it.

## First Hosting Milestone

The first AWS milestone should not include every enterprise feature. It should prove that Percy can run as a hosted control plane.

Milestone target:

- deploy FastAPI cloud control-plane API;
- create org/team/project/access-request objects;
- persist to Postgres;
- write audit events;
- store uploaded placeholder artifacts in S3;
- enqueue a fake job in SQS;
- run a simple ECS worker that completes the job;
- expose the API behind HTTPS.

## Near-Term Build Order

1. Keep the local in-memory control plane for fast development.
2. Add Postgres repository implementation.
3. Add S3 storage implementation behind the existing storage interface.
4. Add job model and local worker runner.
5. Add SQS job queue implementation.
6. Add ECS worker image.
7. Add minimal AWS infrastructure-as-code.
8. Add Cognito or auth broker integration.
9. Add hosted frontend deployment.

