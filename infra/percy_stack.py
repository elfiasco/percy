from pathlib import Path

from aws_cdk import BundlingOptions, CfnOutput, Duration, RemovalPolicy, Stack, Tags
from aws_cdk import aws_applicationautoscaling as autoscaling
from aws_cdk import aws_apprunner as apprunner
from aws_cdk import aws_budgets as budgets
from aws_cdk import aws_cloudwatch as cloudwatch
from aws_cdk import aws_cloudwatch_actions as cw_actions
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_ecs as ecs
from aws_cdk import aws_efs as efs
from aws_cdk import aws_events as events
from aws_cdk import aws_events_targets as events_targets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_rds as rds
from aws_cdk import aws_s3 as s3
from aws_cdk import aws_sns as sns
from aws_cdk import aws_sns_subscriptions as sns_subs
from aws_cdk import aws_sqs as sqs
from constructs import Construct


# Email addresses that receive budget + billing alerts. Override at synth via:
#   cdk deploy --context alert_emails=a@x.com,b@y.com
DEFAULT_ALERT_EMAILS = [
    "bensteel12@verizon.net",
    "ben.steel@berkeley.edu",
]


class PercyCloudDemoStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Cost-allocation tags ──
        # We deliberately DON'T use Tags.of(self).add() here, because
        # propagating tags to AppRunner Service / VpcConnector / etc. forces
        # CloudFormation to replace those resources and the replacement fails
        # with "name already exists". We tag individual safe resources below
        # (S3, RDS, IAM roles, log groups) — those are the meaningful
        # cost-attribution targets anyway. AppRunner already lets us split
        # cost by service-name in Cost Reports without explicit tags.

        # ── Alerts SNS topic (declared early so studio service env can ref it) ──
        alerts_topic = sns.Topic(self, "PercyAlerts", display_name="Percy Dev Alerts")
        # Accept either alert_emails (CSV) or alert_email (single) from --context
        ctx_emails = (
            self.node.try_get_context("alert_emails")
            or self.node.try_get_context("alert_email")
        )
        if ctx_emails:
            alert_emails = [e.strip() for e in str(ctx_emails).split(",") if e.strip()]
        else:
            alert_emails = list(DEFAULT_ALERT_EMAILS)
        for email in alert_emails:
            alerts_topic.add_subscription(sns_subs.EmailSubscription(email))
        # Single primary used by Budget direct EMAIL subscribers (Budget supports
        # multiple EMAIL subscribers — we add all of them via a list below).
        alert_email = alert_emails[0]

        repo_root = Path(__file__).resolve().parents[1]

        # ------------------------------------------------------------------
        # VPC — isolated private subnets only (no NAT, dev cost-optimised)
        # ------------------------------------------------------------------
        vpc = ec2.Vpc(
            self,
            "PercyVpc",
            max_azs=2,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="private",
                    subnet_type=ec2.SubnetType.PRIVATE_ISOLATED,
                    cidr_mask=24,
                ),
            ],
            nat_gateways=0,
        )

        # VPC endpoints so isolated subnets can reach ECR/S3/Secrets Manager
        # without going to the internet.
        vpc.add_interface_endpoint(
            "EcrEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.ECR,
        )
        vpc.add_interface_endpoint(
            "EcrDockerEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        )
        vpc.add_interface_endpoint(
            "SecretsManagerEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        )
        vpc.add_gateway_endpoint(
            "S3Endpoint",
            service=ec2.GatewayVpcEndpointAwsService.S3,
        )
        vpc.add_interface_endpoint(
            "SqsEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.SQS,
        )
        vpc.add_interface_endpoint(
            "EcsEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.ECS,
        )
        vpc.add_interface_endpoint(
            "EcsAgentEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.ECS_AGENT,
        )
        vpc.add_interface_endpoint(
            "EcsTelemetryEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.ECS_TELEMETRY,
        )
        vpc.add_interface_endpoint(
            "CloudWatchLogsEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        )
        # AWS Bedrock runtime — required for Claude Sonnet via Bedrock (editor skill).
        # Without this endpoint, Bedrock calls fail from private subnets.
        vpc.add_interface_endpoint(
            "BedrockEndpoint",
            service=ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
        )

        # ------------------------------------------------------------------
        # Security groups
        # ------------------------------------------------------------------
        apprunner_sg = ec2.SecurityGroup(
            self, "AppRunnerSg",
            vpc=vpc,
            description="Percy App Runner egress",
            allow_all_outbound=True,
        )

        db_sg = ec2.SecurityGroup(
            self, "DbSg",
            vpc=vpc,
            description="Percy RDS Postgres",
            allow_all_outbound=False,
        )
        db_sg.add_ingress_rule(
            peer=apprunner_sg,
            connection=ec2.Port.tcp(5432),
            description="App Runner to Postgres",
        )

        # ------------------------------------------------------------------
        # RDS Postgres
        # ------------------------------------------------------------------
        db = rds.DatabaseInstance(
            self,
            "PercyDb",
            engine=rds.DatabaseInstanceEngine.postgres(
                version=rds.PostgresEngineVersion.VER_16
            ),
            instance_type=ec2.InstanceType.of(
                ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO
            ),
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            security_groups=[db_sg],
            database_name="percy",
            credentials=rds.Credentials.from_generated_secret("percy"),
            removal_policy=RemovalPolicy.DESTROY,
            deletion_protection=False,
            multi_az=False,
            allocated_storage=20,
            storage_encrypted=True,
        )

        # ------------------------------------------------------------------
        # App Runner VPC connector
        # AppRunner VpcConnectors are immutable post-creation. Any tag change
        # via stack-level Tags.of(self).add() forces CloudFormation to
        # replace the resource, and the replacement fails because the same
        # {SGs, subnets} combo can't coexist on two connectors. Strip stack-
        # level tags from this resource so it stays put across deploys.
        # ------------------------------------------------------------------
        vpc_connector = apprunner.CfnVpcConnector(
            self,
            "PercyVpcConnector",
            subnets=vpc.select_subnets(
                subnet_type=ec2.SubnetType.PRIVATE_ISOLATED
            ).subnet_ids,
            security_groups=[apprunner_sg.security_group_id],
            vpc_connector_name="percy-cloud-vpc-connector",
        )
        # No Tags.of() at stack level → nothing to remove here.

        # ------------------------------------------------------------------
        # S3 artifacts bucket
        # ------------------------------------------------------------------
        artifacts_bucket = s3.Bucket(
            self,
            "PercyArtifacts",
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            lifecycle_rules=[
                s3.LifecycleRule(
                    id="expire-tmp",
                    prefix="tmp/",
                    expiration=Duration.days(7),
                ),
            ],
        )

        # ------------------------------------------------------------------
        # SQS job queues
        # ------------------------------------------------------------------
        onboard_dlq = sqs.Queue(
            self,
            "OnboardDlq",
            queue_name="percy-onboard-document-dlq",
            retention_period=Duration.days(14),
        )
        onboard_queue = sqs.Queue(
            self,
            "OnboardQueue",
            queue_name="percy-onboard-document",
            visibility_timeout=Duration.minutes(15),
            retention_period=Duration.days(4),
            dead_letter_queue=sqs.DeadLetterQueue(
                max_receive_count=3,
                queue=onboard_dlq,
            ),
        )

        # ------------------------------------------------------------------
        # ECR image
        # ------------------------------------------------------------------
        image = ecr_assets.DockerImageAsset(
            self,
            "PercyCloudApiImage",
            directory=str(repo_root),
            file="Dockerfile.cloud",
        )

        # ------------------------------------------------------------------
        # IAM roles
        # ------------------------------------------------------------------
        access_role = iam.Role(
            self,
            "PercyAppRunnerEcrAccessRole",
            assumed_by=iam.ServicePrincipal("build.apprunner.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSAppRunnerServicePolicyForECRAccess"
                )
            ],
        )

        instance_role = iam.Role(
            self,
            "PercyAppRunnerInstanceRole",
            assumed_by=iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        )
        from aws_cdk import aws_secretsmanager as secretsmanager
        api_key_secret = secretsmanager.Secret(
            self,
            "PercyApiKeySecret",
            description="Percy Cloud API key",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                password_length=48,
                exclude_punctuation=True,
            ),
            removal_policy=RemovalPolicy.RETAIN,
        )

        db.secret.grant_read(instance_role)
        api_key_secret.grant_read(instance_role)
        artifacts_bucket.grant_read_write(instance_role)
        onboard_queue.grant_send_messages(instance_role)

        # ------------------------------------------------------------------
        # App Runner service
        # ------------------------------------------------------------------
        service = apprunner.CfnService(
            self,
            "PercyCloudApi",
            service_name="percy-cloud-api-dev",
            source_configuration=apprunner.CfnService.SourceConfigurationProperty(
                authentication_configuration=apprunner.CfnService.AuthenticationConfigurationProperty(
                    access_role_arn=access_role.role_arn,
                ),
                auto_deployments_enabled=False,
                image_repository=apprunner.CfnService.ImageRepositoryProperty(
                    image_identifier=image.image_uri,
                    image_repository_type="ECR",
                    image_configuration=apprunner.CfnService.ImageConfigurationProperty(
                        port="8000",
                        runtime_environment_variables=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_ENV", value="dev"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_HOST", value=db.db_instance_endpoint_address
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PORT", value=db.db_instance_endpoint_port
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_NAME", value="percy"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_USER", value="percy"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="S3_BUCKET", value=artifacts_bucket.bucket_name
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="SQS_ONBOARD_QUEUE_URL", value=onboard_queue.queue_url
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="AWS_DEFAULT_REGION", value=self.region
                            ),
                        ],
                        runtime_environment_secrets=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PASSWORD",
                                value=f"{db.secret.secret_arn}:password::",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_API_KEY",
                                value=api_key_secret.secret_arn,
                            ),
                        ],
                    ),
                ),
            ),
            instance_configuration=apprunner.CfnService.InstanceConfigurationProperty(
                cpu="0.25 vCPU",
                memory="0.5 GB",
                instance_role_arn=instance_role.role_arn,
            ),
            network_configuration=apprunner.CfnService.NetworkConfigurationProperty(
                egress_configuration=apprunner.CfnService.EgressConfigurationProperty(
                    egress_type="VPC",
                    vpc_connector_arn=vpc_connector.attr_vpc_connector_arn,
                ),
            ),
            health_check_configuration=apprunner.CfnService.HealthCheckConfigurationProperty(
                protocol="HTTP",
                path="/api/cloud/health",
                interval=10,
                timeout=5,
                healthy_threshold=1,
                unhealthy_threshold=5,
            ),
        )

        CfnOutput(
            self,
            "PercyApiUrl",
            value=f"https://{service.attr_service_url}",
        )

        # ------------------------------------------------------------------
        # Percy Studio — workspace API + React frontend
        # ------------------------------------------------------------------
        # The collab service URL is stable for the lifetime of the stack; the
        # studio image bakes it in as VITE_YJS_WS_URL so the SPA can connect
        # the Yjs websocket transport. Without this, multiplayer falls back
        # to BroadcastChannel (same-browser-only) and remote cursors / live
        # collaboration appear broken.
        studio_image = ecr_assets.DockerImageAsset(
            self,
            "PercyStudioImage",
            directory=str(repo_root),
            file="Dockerfile.studio",
            build_args={
                # WebSocket relay. App Runner's Envoy returns 403 on every
                # wss:// upgrade regardless of egress config — verified with
                # raw curl on every service in the account. Lightsail
                # Containers DO support WebSocket upgrades natively, so the
                # collab service runs there. The App Runner collab service
                # is left in place but unused (would be removed on cleanup).
                "VITE_YJS_WS_URL": "wss://percy-collab.16m6vj1w4md2c.us-east-1.cs.amazonlightsail.com",
            },
        )

        # Anthropic API key secret (must be manually populated after first deploy)
        from aws_cdk import aws_secretsmanager as secretsmanager  # noqa: F811
        anthropic_secret = secretsmanager.Secret.from_secret_name_v2(
            self, "AnthropicApiKeySecret", "percy/anthropic-api-key"
        )

        # OpenAI API key — used by the Coder skill (Codex via Responses API).
        # Manually populate in Secrets Manager after first deploy:
        #   aws secretsmanager create-secret --name percy/openai-api-key \
        #       --secret-string "sk-..." --profile percy-dev
        openai_secret = secretsmanager.Secret.from_secret_name_v2(
            self, "OpenAiApiKeySecret", "percy/openai-api-key"
        )

        # JWT signing secret — auto-generated by CDK, stored in Secrets Manager.
        # If you rotate this, all logged-in users will be signed out.
        jwt_secret = secretsmanager.Secret(
            self, "PercyJwtSecret",
            secret_name="percy/jwt-secret",
            description="HS256 secret used to sign Percy session JWTs",
            generate_secret_string=secretsmanager.SecretStringGenerator(
                exclude_punctuation=True,
                password_length=64,
            ),
        )

        # Google OAuth credentials — must be populated manually with client_id + client_secret.
        # If absent, Google sign-in is disabled but email/password auth still works.
        google_oauth_secret = secretsmanager.Secret.from_secret_name_v2(
            self, "GoogleOAuthSecret", "percy/google-oauth"
        )

        studio_instance_role = iam.Role(
            self,
            "PercyStudioInstanceRole",
            assumed_by=iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        )
        artifacts_bucket.grant_read_write(studio_instance_role)
        api_key_secret.grant_read(studio_instance_role)
        anthropic_secret.grant_read(studio_instance_role)
        openai_secret.grant_read(studio_instance_role)
        jwt_secret.grant_read(studio_instance_role)
        google_oauth_secret.grant_read(studio_instance_role)
        db.secret.grant_read(studio_instance_role)

        # ── Bedrock access for Claude foundation models (enterprise LLM path) ──
        # Grant invoke + streaming on Anthropic FMs. Cross-region inference
        # profiles auto-route across us-east-1/us-west-2/us-east-2 — list those.
        studio_instance_role.add_to_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "bedrock:InvokeModel",
                "bedrock:InvokeModelWithResponseStream",
                "bedrock:Converse",
                "bedrock:ConverseStream",
                "bedrock:ApplyGuardrail",
            ],
            resources=[
                # Direct foundation-model invocations
                f"arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
                # Cross-region inference profiles (Sonnet 4.5+ defaults to these)
                f"arn:aws:bedrock:*:{self.account}:inference-profile/us.anthropic.claude-*",
                f"arn:aws:bedrock:*:{self.account}:inference-profile/anthropic.claude-*",
            ],
        ))
        # Cost-allocation tags — IAM roles are safe to tag (no replacement).
        Tags.of(studio_instance_role).add("App", "Percy")
        Tags.of(studio_instance_role).add("Component", "studio")
        Tags.of(studio_instance_role).add("Env", "dev")

        # Studio dispatches team-env jobs onto the onboard SQS queue.
        onboard_queue.grant_send_messages(studio_instance_role)

        studio_service = apprunner.CfnService(
            self,
            "PercyStudio",
            service_name="percy-studio-dev",
            source_configuration=apprunner.CfnService.SourceConfigurationProperty(
                authentication_configuration=apprunner.CfnService.AuthenticationConfigurationProperty(
                    access_role_arn=access_role.role_arn,
                ),
                auto_deployments_enabled=False,
                image_repository=apprunner.CfnService.ImageRepositoryProperty(
                    image_identifier=studio_image.image_uri,
                    image_repository_type="ECR",
                    image_configuration=apprunner.CfnService.ImageConfigurationProperty(
                        port="8000",
                        runtime_environment_variables=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_ENV", value="prod"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="S3_BUCKET", value=artifacts_bucket.bucket_name
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="AWS_DEFAULT_REGION", value=self.region
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_CLOUD_API_URL",
                                value=f"https://{service.attr_service_url}",
                            ),
                            # ── DB connection (RDS Postgres in same VPC) ────────────
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_HOST", value=db.db_instance_endpoint_address
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PORT", value=db.db_instance_endpoint_port
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_NAME", value="percy"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_USER", value="percy"
                            ),
                            # Google OAuth redirect points back at this same service.
                            # CFN can't self-reference `studio_service.attr_service_url`
                            # in its own env vars (circular), so we hardcode the
                            # *actual* App Runner-assigned URL. If the service is
                            # ever recreated (different runtime ID), update this
                            # string and re-add it as an Authorized Redirect URI
                            # in Google Cloud Console.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="GOOGLE_OAUTH_REDIRECT_URI",
                                value="https://36kuepamyi.us-east-1.awsapprunner.com/api/auth/google/callback",
                            ),
                            # ── Bedrock LLM provider (enterprise mode) ─────
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_LLM_PROVIDER", value="bedrock",
                            ),
                            # Default model — switch via this env var without redeploying
                            # code. Override per-call by setting body.context.model.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_BEDROCK_MODEL",
                                # Cross-region inference profile — required for Claude 4.x
                                # (direct model IDs reject on-demand invocations).
                                value="us.anthropic.claude-sonnet-4-6",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_BEDROCK_REGION", value=self.region,
                            ),
                                                # ── Codex (OpenAI) for Coder skill ────────────
                            # PERCY_CODER_MODEL selects the Codex model for
                            # scripted_plan generation. codex-mini-latest is
                            # fast and code-optimized; override to o4-mini for
                            # harder multi-step scripts.
                            #
                            # NOTE: OpenAI calls require internet egress. This
                            # VPC uses nat_gateways=0 (cost-optimised). Until
                            # a NAT gateway is added (cdk deploy with nat_gateways=1
                            # in percy_stack.py), the coder falls back to Bedrock
                            # Claude automatically — no configuration change needed.
                            # To add NAT: change nat_gateways=0 → 1 above and redeploy.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_CODER_MODEL", value="codex-mini-latest",
                            ),
                            # Reasoning effort: low | medium | high
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_CODEX_REASONING", value="medium",
                            ),
                            # ── Per-org budget defaults (enforced in app) ──
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_DEFAULT_DAILY_USD_BUDGET", value="5",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_DEFAULT_MONTHLY_USD_BUDGET", value="50",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_ALERTS_TOPIC_ARN",
                                value=alerts_topic.topic_arn,
                            ),
                            # Studio dispatches team-env eval/build/refresh jobs onto the
                            # same SQS queue the onboard worker reads. The worker discriminates
                            # on the message body's `kind` field.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="SQS_ONBOARD_QUEUE_URL", value=onboard_queue.queue_url,
                            ),
                        ],
                        runtime_environment_secrets=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_API_KEY",
                                value=api_key_secret.secret_arn,
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="ANTHROPIC_API_KEY",
                                value=anthropic_secret.secret_arn,
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PASSWORD",
                                value=f"{db.secret.secret_arn}:password::",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_JWT_SECRET",
                                value=jwt_secret.secret_arn,
                            ),
                            # Google OAuth secret stores a JSON dict {client_id, client_secret}.
                            # Until populated, Google sign-in returns 503 — email/password
                            # works regardless.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="GOOGLE_OAUTH_CLIENT_ID",
                                value=f"{google_oauth_secret.secret_arn}:client_id::",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="GOOGLE_OAUTH_CLIENT_SECRET",
                                value=f"{google_oauth_secret.secret_arn}:client_secret::",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="OPENAI_API_KEY",
                                value=openai_secret.secret_arn,
                            ),
                        ],
                    ),
                ),
            ),
            instance_configuration=apprunner.CfnService.InstanceConfigurationProperty(
                cpu="1 vCPU",
                memory="2 GB",
                instance_role_arn=studio_instance_role.role_arn,
            ),
            network_configuration=apprunner.CfnService.NetworkConfigurationProperty(
                egress_configuration=apprunner.CfnService.EgressConfigurationProperty(
                    egress_type="VPC",
                    vpc_connector_arn=vpc_connector.attr_vpc_connector_arn,
                ),
            ),
            health_check_configuration=apprunner.CfnService.HealthCheckConfigurationProperty(
                protocol="HTTP",
                path="/api/health",
                interval=10,
                timeout=5,
                healthy_threshold=1,
                unhealthy_threshold=5,
            ),
        )

        # AppRunner refuses concurrent operations on services that share a
        # VpcConnector — without an explicit dep, CFN can fire updates in
        # parallel and one fails with "OPERATION_IN_PROGRESS". Force the
        # studio service to update only after the cloud API has settled.
        studio_service.add_dependency(service)

        CfnOutput(
            self,
            "PercyStudioUrl",
            value=f"https://{studio_service.attr_service_url}",
        )
        CfnOutput(
            self,
            "PercyJwtSecretArn",
            value=jwt_secret.secret_arn,
            description="Auto-generated JWT signing secret. Rotate via Secrets Manager.",
        )
        CfnOutput(
            self,
            "PercyGoogleOAuthSecretName",
            value="percy/google-oauth",
            description="Manually populate with JSON {client_id, client_secret} from Google Cloud Console.",
        )

        # ------------------------------------------------------------------
        # Percy Collab — Yjs WebSocket relay for studio multiplayer
        # ------------------------------------------------------------------
        collab_image = ecr_assets.DockerImageAsset(
            self,
            "PercyCollabImage",
            directory=str(repo_root / "server" / "collab"),
            file="Dockerfile",
        )

        collab_instance_role = iam.Role(
            self,
            "PercyCollabInstanceRole",
            assumed_by=iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
        )
        # Same secrets the studio uses — collab forwards user JWTs and reads
        # the same DB. JWT_SECRET must match exactly so connections authenticate.
        jwt_secret.grant_read(collab_instance_role)
        db.secret.grant_read(collab_instance_role)
        Tags.of(collab_instance_role).add("CostCenter", "percy-collab")

        collab_service = apprunner.CfnService(
            self,
            "PercyCollab",
            service_name="percy-collab-dev",
            source_configuration=apprunner.CfnService.SourceConfigurationProperty(
                authentication_configuration=apprunner.CfnService.AuthenticationConfigurationProperty(
                    access_role_arn=access_role.role_arn,
                ),
                auto_deployments_enabled=False,
                image_repository=apprunner.CfnService.ImageRepositoryProperty(
                    image_identifier=collab_image.image_uri,
                    image_repository_type="ECR",
                    image_configuration=apprunner.CfnService.ImageConfigurationProperty(
                        port="1234",
                        runtime_environment_variables=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="NODE_ENV", value="production"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_API_BASE",
                                value=f"https://{studio_service.attr_service_url}",
                            ),
                            # DB for snapshot persistence (same Postgres as the studio)
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_HOST", value=db.db_instance_endpoint_address
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PORT", value=db.db_instance_endpoint_port
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_NAME", value="percy"
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_USER", value="percy"
                            ),
                        ],
                        runtime_environment_secrets=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_JWT_SECRET",
                                value=jwt_secret.secret_arn,
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PASSWORD",
                                value=f"{db.secret.secret_arn}:password::",
                            ),
                        ],
                        # No start_command override — use the Dockerfile's CMD
                        # ("node server.js"). The earlier attempt at composing
                        # DATABASE_URL via shell substitution hit AppRunner's
                        # start_command quoting limits and the container died
                        # immediately. server.js falls back to filesystem
                        # snapshots when DATABASE_URL is unset, which is fine
                        # for v1 — wire Postgres back in once we either (a)
                        # compose DATABASE_URL inside server.js from the
                        # individual DB_* vars or (b) write a small entrypoint
                        # script in the image that does it cleanly.
                    ),
                ),
            ),
            instance_configuration=apprunner.CfnService.InstanceConfigurationProperty(
                cpu="0.5 vCPU",
                memory="1 GB",
                instance_role_arn=collab_instance_role.role_arn,
            ),
            network_configuration=apprunner.CfnService.NetworkConfigurationProperty(
                # IMPORTANT: collab MUST use DEFAULT (not VPC) egress.
                # App Runner's WebSocket support is incompatible with VPC
                # connectors — every wss:// upgrade returns 403 from Envoy
                # when a VPC connector is configured. With DEFAULT egress
                # the WS handshake succeeds. Collab doesn't need VPC reach
                # anyway: it talks to the studio's PUBLIC URL for verifyUser
                # and writes snapshots to S3 (also public). Postgres
                # snapshot persistence is disabled by leaving DATABASE_URL
                # unset; server.js falls back to filesystem snapshots,
                # which is acceptable for v1.
                egress_configuration=apprunner.CfnService.EgressConfigurationProperty(
                    egress_type="DEFAULT",
                ),
            ),
            health_check_configuration=apprunner.CfnService.HealthCheckConfigurationProperty(
                protocol="HTTP",
                path="/healthz",
                interval=10,
                timeout=5,
                healthy_threshold=1,
                unhealthy_threshold=5,
            ),
        )

        CfnOutput(
            self,
            "PercyCollabUrl",
            value=f"wss://{collab_service.attr_service_url}",
            description="Set VITE_YJS_WS_URL to this when building the frontend.",
        )

        # Sequence collab service after studio for the same reason — avoid
        # AppRunner's "OPERATION_IN_PROGRESS" when multiple services share
        # the VpcConnector and CFN tries parallel updates.
        collab_service.add_dependency(studio_service)

        # ------------------------------------------------------------------
        # ECS cluster + onboard worker service
        # ------------------------------------------------------------------
        cluster = ecs.Cluster(self, "PercyWorkerCluster", vpc=vpc)

        worker_image = ecr_assets.DockerImageAsset(
            self,
            "PercyWorkerImage",
            directory=str(repo_root),
            file="Dockerfile.worker",
        )

        worker_task = ecs.FargateTaskDefinition(
            self,
            "OnboardWorkerTask",
            cpu=512,
            memory_limit_mib=1024,
        )
        db.secret.grant_read(worker_task.task_role)
        api_key_secret.grant_read(worker_task.task_role)
        artifacts_bucket.grant_read_write(worker_task.task_role)
        onboard_queue.grant_consume_messages(worker_task.task_role)

        worker_log_group = logs.LogGroup(
            self,
            "OnboardWorkerLogs",
            log_group_name="/percy/worker/onboard",
            removal_policy=RemovalPolicy.DESTROY,
            retention=logs.RetentionDays.ONE_WEEK,
        )

        worker_task.add_container(
            "OnboardWorker",
            image=ecs.ContainerImage.from_docker_image_asset(worker_image),
            logging=ecs.LogDrivers.aws_logs(
                stream_prefix="onboard",
                log_group=worker_log_group,
            ),
            environment={
                "PERCY_ENV": "dev",
                "S3_BUCKET": artifacts_bucket.bucket_name,
                "SQS_ONBOARD_QUEUE_URL": onboard_queue.queue_url,
                "PERCY_API_URL": f"https://{service.attr_service_url}",
                "AWS_DEFAULT_REGION": self.region,
                "DB_HOST": db.db_instance_endpoint_address,
                "DB_PORT": db.db_instance_endpoint_port,
                "DB_NAME": "percy",
                "DB_USER": "percy",
                # EFS-backed venv root (mounted via the task definition's volume).
                "PERCY_TEAM_ENVS_DIR": "/efs/team-envs",
            },
            secrets={
                "DB_PASSWORD": ecs.Secret.from_secrets_manager(db.secret, "password"),
                "PERCY_API_KEY": ecs.Secret.from_secrets_manager(api_key_secret),
            },
        )

        worker_sg = ec2.SecurityGroup(
            self, "WorkerSg",
            vpc=vpc,
            description="Percy ECS worker egress",
            allow_all_outbound=True,
        )
        db_sg.add_ingress_rule(
            peer=worker_sg,
            connection=ec2.Port.tcp(5432),
            description="Worker to Postgres",
        )

        # ─── EFS for persistent team-env venvs (Option C) ───────────────────
        # The worker mounts an EFS access point at /efs/team-envs so each
        # team's venv (built once, hundreds of MB of pip-installed deps)
        # survives task restarts and is shared across worker instances.
        efs_sg = ec2.SecurityGroup(
            self, "TeamEnvsEfsSg",
            vpc=vpc,
            description="Percy team-envs EFS",
            allow_all_outbound=True,
        )
        efs_sg.add_ingress_rule(
            peer=worker_sg,
            connection=ec2.Port.tcp(2049),
            description="Worker to EFS NFS",
        )
        team_envs_fs = efs.FileSystem(
            self, "TeamEnvsFs",
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            security_group=efs_sg,
            performance_mode=efs.PerformanceMode.GENERAL_PURPOSE,
            throughput_mode=efs.ThroughputMode.BURSTING,
            encrypted=True,
            removal_policy=RemovalPolicy.RETAIN,
            file_system_name="percy-team-envs",
        )
        team_envs_ap = efs.AccessPoint(
            self, "TeamEnvsAp",
            file_system=team_envs_fs,
            path="/team-envs",
            create_acl=efs.Acl(owner_uid="0", owner_gid="0", permissions="0755"),
            posix_user=efs.PosixUser(uid="0", gid="0"),
        )

        worker_task.add_volume(
            name="team-envs",
            efs_volume_configuration=ecs.EfsVolumeConfiguration(
                file_system_id=team_envs_fs.file_system_id,
                transit_encryption="ENABLED",
                authorization_config=ecs.AuthorizationConfig(
                    access_point_id=team_envs_ap.access_point_id,
                    iam="ENABLED",
                ),
            ),
        )
        worker_task.default_container.add_mount_points(  # type: ignore[union-attr]
            ecs.MountPoint(
                container_path="/efs/team-envs",
                source_volume="team-envs",
                read_only=False,
            ),
        )
        # Task role needs permission to mount the EFS access point.
        worker_task.task_role.add_to_principal_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=[
                "elasticfilesystem:ClientMount",
                "elasticfilesystem:ClientWrite",
                "elasticfilesystem:ClientRootAccess",
            ],
            resources=[team_envs_fs.file_system_arn],
            conditions={
                "StringEquals": {
                    "elasticfilesystem:AccessPointArn": team_envs_ap.access_point_arn,
                },
            },
        ))

        worker_service = ecs.FargateService(
            self,
            "OnboardWorkerService",
            cluster=cluster,
            task_definition=worker_task,
            desired_count=1,  # keep one warm so eval/refresh latency is ~1-2s
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            security_groups=[worker_sg],
            assign_public_ip=False,
        )

        # Auto-scale 1→3 based on SQS queue depth
        scalable_target = worker_service.auto_scale_task_count(
            min_capacity=1,
            max_capacity=3,
        )
        scalable_target.scale_on_metric(
            "ScaleOnQueueDepth",
            metric=onboard_queue.metric_approximate_number_of_messages_visible(
                period=Duration.minutes(1)
            ),
            scaling_steps=[
                autoscaling.ScalingInterval(upper=0, change=-1),   # scale in when empty
                autoscaling.ScalingInterval(lower=1, change=+1),   # 1 task per message
                autoscaling.ScalingInterval(lower=10, change=+1),  # 2 tasks at 10+
                autoscaling.ScalingInterval(lower=25, change=+1),  # 3 tasks at 25+
            ],
            adjustment_type=autoscaling.AdjustmentType.CHANGE_IN_CAPACITY,
            cooldown=Duration.minutes(2),
        )

        # ------------------------------------------------------------------
        # Observability — CloudWatch alarms + AWS Budgets (cost guardrails)
        # alerts_topic was declared at the top of this method so the studio
        # service env config could reference it; the budgets/alarms below
        # subscribe to it.
        # ------------------------------------------------------------------

        # ── AWS Budgets — GROSS cost (pre-credit) with $20 increment alerts ──
        # IncludeCredit=False makes this track real usage cost, NOT what you
        # owe after AWS Activate credits. We want to know burn rate, not net.
        #
        # One $200 budget with thresholds at 10/20/30/.../100% gives us alerts
        # at $20, $40, $60, $80, $100, $120, $140, $160, $180, $200 of GROSS
        # spend — every $20 step exactly as requested.
        # Budget direct EMAIL subscriber is pinned to the FIRST alert email
        # only. AWS Budgets refuses in-place subscriber-list mutation on an
        # existing budget ("same name but different internalId"), so we keep
        # the on-budget subscriber identical to what was originally deployed.
        # All additional addresses receive alerts via the SNS topic, which
        # fans out to every entry in alert_emails. Same end-result, no churn.
        primary_budget_email = alert_emails[0]
        gross_budget_subscribers = [
            budgets.CfnBudget.SubscriberProperty(
                subscription_type="EMAIL", address=primary_budget_email,
            ),
            budgets.CfnBudget.SubscriberProperty(
                subscription_type="SNS", address=alerts_topic.topic_arn,
            ),
        ]
        # AWS Budgets caps notifications at 10 per budget. Use all 10 for the
        # actual-spend $20-increment alerts (10/20/.../100% of $200). The
        # forecasted alert lives on the separate net-spend emergency budget.
        gross_budget_notifications = [
            budgets.CfnBudget.NotificationWithSubscribersProperty(
                notification=budgets.CfnBudget.NotificationProperty(
                    notification_type="ACTUAL",
                    comparison_operator="GREATER_THAN",
                    threshold=pct,
                    threshold_type="PERCENTAGE",
                ),
                subscribers=gross_budget_subscribers,
            )
            for pct in (10, 20, 30, 40, 50, 60, 70, 80, 90, 100)
        ]

        budgets.CfnBudget(
            self, "PercyGrossSpendBudget",
            budget=budgets.CfnBudget.BudgetDataProperty(
                budget_name="percy-gross-monthly-200",
                budget_type="COST",
                time_unit="MONTHLY",
                budget_limit=budgets.CfnBudget.SpendProperty(amount=200, unit="USD"),
                # ── Track GROSS, not net ──
                # By default, AWS Budgets includes credits (so a $7.58 spend
                # covered by credits looks like $0). Turning credits off lets
                # us see real burn so the credit cliff doesn't surprise us.
                cost_types=budgets.CfnBudget.CostTypesProperty(
                    include_credit=False,         # exclude AWS Activate credits
                    include_discount=True,
                    include_other_subscription=True,
                    include_recurring=True,
                    include_refund=False,
                    include_subscription=True,
                    include_support=True,
                    include_tax=True,
                    include_upfront=True,
                    use_amortized=False,
                    use_blended=False,
                ),
            ),
            notifications_with_subscribers=gross_budget_notifications,
        )

        # Net-spend safety net at $500 — fires only when credits run out and
        # actual money starts going out the door.
        budgets.CfnBudget(
            self, "PercyNetSpendEmergency",
            budget=budgets.CfnBudget.BudgetDataProperty(
                budget_name="percy-net-emergency-500",
                budget_type="COST",
                time_unit="MONTHLY",
                budget_limit=budgets.CfnBudget.SpendProperty(amount=500, unit="USD"),
            ),
            notifications_with_subscribers=[
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=50,
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=gross_budget_subscribers,
                ),
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=100,
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=gross_budget_subscribers,
                ),
            ],
        )

        # ── CloudWatch billing alarm (us-east-1 only — that's where Billing
        #    metrics live) — fires when estimated charges exceed $50 in the
        #    current month. Belt-and-suspenders alongside Budgets. ──
        billing_alarm = cloudwatch.Alarm(
            self, "PercyBillingAlarm",
            alarm_name="percy-monthly-billing-50usd",
            metric=cloudwatch.Metric(
                namespace="AWS/Billing", metric_name="EstimatedCharges",
                dimensions_map={"Currency": "USD"},
                statistic="Maximum", period=Duration.hours(6),
            ),
            threshold=50,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            alarm_description="Estimated AWS charges this month exceeded $50",
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        billing_alarm.add_alarm_action(cw_actions.SnsAction(alerts_topic))

        # ── Bedrock model invocation logging ──
        # Every Bedrock InvokeModel call writes to a CloudWatch log group AND
        # an S3 bucket so we have a permanent compliance/audit trail of every
        # prompt + response. Required for SOC 2; useful for debugging too.
        bedrock_log_group = logs.LogGroup(
            self, "BedrockInvocationLogs",
            log_group_name="/aws/bedrock/percy-invocations",
            retention=logs.RetentionDays.SIX_MONTHS,
            removal_policy=RemovalPolicy.DESTROY,
        )
        # IAM role Bedrock assumes to write to the log group + S3
        bedrock_logging_role = iam.Role(
            self, "BedrockLoggingRole",
            assumed_by=iam.ServicePrincipal("bedrock.amazonaws.com"),
            inline_policies={
                "WriteLogs": iam.PolicyDocument(statements=[
                    iam.PolicyStatement(
                        effect=iam.Effect.ALLOW,
                        actions=["logs:CreateLogStream", "logs:PutLogEvents"],
                        resources=[bedrock_log_group.log_group_arn,
                                    f"{bedrock_log_group.log_group_arn}:*"],
                    ),
                    iam.PolicyStatement(
                        effect=iam.Effect.ALLOW,
                        actions=["s3:PutObject"],
                        resources=[f"{artifacts_bucket.bucket_arn}/bedrock-logs/*"],
                    ),
                ]),
            },
        )
        # The actual ``bedrock:PutModelInvocationLoggingConfiguration`` call
        # happens via a CloudFormation custom resource (CfnResource doesn't
        # have a clean native binding for it yet). For now, we provision the
        # log group + role; the user runs:
        #
        #   aws bedrock put-model-invocation-logging-configuration \
        #     --logging-config '{"cloudWatchConfig":{"logGroupName":"/aws/bedrock/percy-invocations","roleArn":"<role>"}, "textDataDeliveryEnabled":true, "imageDataDeliveryEnabled":true, "embeddingDataDeliveryEnabled":false}'
        #
        # to flip on logging once. Output the role ARN so it's easy to copy.
        CfnOutput(self, "BedrockLogGroupName", value=bedrock_log_group.log_group_name)
        CfnOutput(self, "BedrockLoggingRoleArn", value=bedrock_logging_role.role_arn)

        # DLQ depth — any message here means a job failed 3x
        cloudwatch.Alarm(
            self, "OnboardDlqDepth",
            metric=onboard_dlq.metric_approximate_number_of_messages_visible(
                period=Duration.minutes(5)
            ),
            threshold=1,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            alarm_description="Percy onboard DLQ has messages — jobs failing repeatedly",
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        ).add_alarm_action(cw_actions.SnsAction(alerts_topic))

        # Queue depth — jobs piling up
        cloudwatch.Alarm(
            self, "OnboardQueueDepth",
            metric=onboard_queue.metric_approximate_number_of_messages_visible(
                period=Duration.minutes(5)
            ),
            threshold=50,
            evaluation_periods=2,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            alarm_description="Percy onboard queue depth high — worker may be stuck",
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        ).add_alarm_action(cw_actions.SnsAction(alerts_topic))

        # ------------------------------------------------------------------
        # Refresh Scheduler Lambda — re-onboards all ready documents daily
        # ------------------------------------------------------------------
        refresh_lambda = lambda_.Function(
            self,
            "PercyRefreshScheduler",
            function_name="percy-refresh-scheduler-dev",
            runtime=lambda_.Runtime.PYTHON_3_13,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                str(repo_root / "lambda" / "refresh_scheduler"),
                bundling=BundlingOptions(
                    image=lambda_.Runtime.PYTHON_3_13.bundling_image,
                    command=[
                        "bash", "-c",
                        "pip install -r requirements.txt -t /asset-output --quiet "
                        "&& cp handler.py /asset-output/",
                    ],
                ),
            ),
            timeout=Duration.minutes(5),
            memory_size=256,
            environment={
                "SQS_ONBOARD_QUEUE_URL": onboard_queue.queue_url,
                "DB_HOST": db.db_instance_endpoint_address,
                "DB_PORT": db.db_instance_endpoint_port,
                "DB_NAME": "percy",
                "DB_USER": "percy",
            },
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            security_groups=[worker_sg],  # reuse worker SG (allows DB + VPC endpoints)
            log_retention=logs.RetentionDays.ONE_WEEK,
        )
        # Lambda needs DB password
        db.secret.grant_read(refresh_lambda.role)
        # Add DB_PASSWORD via secret env at deploy time (using SSM trick not available;
        # instead pull from Secrets Manager in the Lambda itself or inject as env secret)
        refresh_lambda.add_environment("DB_SECRET_ARN", db.secret.secret_arn)

        # Grant Lambda access to read secrets and send to SQS
        onboard_queue.grant_send_messages(refresh_lambda.role)

        # EventBridge rule — run every 24 hours at 03:00 UTC
        events.Rule(
            self,
            "PercyDailyRefresh",
            rule_name="percy-daily-refresh-dev",
            description="Triggers Percy document re-onboarding for all ready documents",
            schedule=events.Schedule.cron(hour="3", minute="0"),
            targets=[events_targets.LambdaFunction(refresh_lambda)],
        )

        CfnOutput(self, "PercyRefreshSchedulerArn", value=refresh_lambda.function_arn)

        # ------------------------------------------------------------------
        # Spend-monitor Lambda — $20-step alerts, uncapped past $200 (where
        # the AWS Budget tops out). Runs every 4 hours, queries Cost Explorer
        # for gross spend (RECORD_TYPE=Usage), tracks last-alerted threshold
        # in SSM Parameter Store, publishes to SNS each $20 boundary crossed.
        # SNS fans out to every subscribed email.
        # ------------------------------------------------------------------
        spend_monitor_lambda = lambda_.Function(
            self,
            "PercySpendMonitor",
            function_name="percy-spend-monitor-dev",
            runtime=lambda_.Runtime.PYTHON_3_13,
            handler="handler.lambda_handler",
            code=lambda_.Code.from_asset(
                str(repo_root / "lambda" / "spend_monitor"),
                # No deps to bundle — boto3 is provided by the Lambda runtime.
            ),
            timeout=Duration.minutes(2),
            memory_size=256,
            environment={
                "ALERTS_TOPIC_ARN": alerts_topic.topic_arn,
                "PARAM_NAME": "/percy/spend/last-alert",
                "STEP_USD": "20",
                "STUDIO_URL": f"https://36kuepamyi.us-east-1.awsapprunner.com",
                # ── Kill switch — pause services + stop RDS at $200 gross ──
                "KILL_USD": "200",
                "KILL_PARAM": "/percy/spend/kill-state",
                "APPRUNNER_SERVICE_ARNS": ",".join([
                    service.attr_service_arn,
                    studio_service.attr_service_arn,
                    collab_service.attr_service_arn,
                ]),
                "RDS_INSTANCE_IDS": db.instance_identifier,
            },
            log_retention=logs.RetentionDays.ONE_MONTH,
        )
        # IAM: Cost Explorer read, SSM parameter R/W (scoped), SNS publish
        spend_monitor_lambda.add_to_role_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["ce:GetCostAndUsage", "ce:GetCostForecast"],
            resources=["*"],  # CE doesn't support resource-level scoping
        ))
        spend_monitor_lambda.add_to_role_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["ssm:GetParameter", "ssm:PutParameter"],
            resources=[f"arn:aws:ssm:{self.region}:{self.account}:parameter/percy/spend/*"],
        ))
        # Kill-switch IAM — pause App Runner services (scoped), stop RDS instance
        spend_monitor_lambda.add_to_role_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["apprunner:PauseService", "apprunner:ResumeService", "apprunner:DescribeService"],
            resources=[
                service.attr_service_arn,
                studio_service.attr_service_arn,
                collab_service.attr_service_arn,
            ],
        ))
        spend_monitor_lambda.add_to_role_policy(iam.PolicyStatement(
            effect=iam.Effect.ALLOW,
            actions=["rds:StopDBInstance", "rds:StartDBInstance", "rds:DescribeDBInstances"],
            # rds:StopDBInstance/StartDBInstance need both the db and any cluster ARN; scope to the db.
            resources=[
                f"arn:aws:rds:{self.region}:{self.account}:db:{db.instance_identifier}",
            ],
        ))
        alerts_topic.grant_publish(spend_monitor_lambda)

        # EventBridge — fire every 4 hours
        events.Rule(
            self,
            "PercySpendMonitorSchedule",
            rule_name="percy-spend-monitor-1h",
            description="Triggers Percy spend monitor every hour to check for $20 boundary crossings + $200 kill switch",
            schedule=events.Schedule.rate(Duration.hours(1)),
            targets=[events_targets.LambdaFunction(spend_monitor_lambda)],
        )
        CfnOutput(self, "PercySpendMonitorArn", value=spend_monitor_lambda.function_arn)

        CfnOutput(self, "PercyDbSecretArn", value=db.secret.secret_arn)
        CfnOutput(self, "PercyApiKeySecretArn", value=api_key_secret.secret_arn)
        CfnOutput(self, "PercyArtifactsBucket", value=artifacts_bucket.bucket_name)
        CfnOutput(self, "PercyOnboardQueueUrl", value=onboard_queue.queue_url)
        CfnOutput(self, "PercyAlertsTopicArn", value=alerts_topic.topic_arn)
