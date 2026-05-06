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


# Email address that receives budget + billing alerts. Override at synth via:
#   cdk deploy --context alert_email=you@example.com
DEFAULT_ALERT_EMAIL = "bensteel12@verizon.net"


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
        alert_email = self.node.try_get_context("alert_email") or DEFAULT_ALERT_EMAIL
        alerts_topic.add_subscription(sns_subs.EmailSubscription(alert_email))

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
        studio_image = ecr_assets.DockerImageAsset(
            self,
            "PercyStudioImage",
            directory=str(repo_root),
            file="Dockerfile.studio",
        )

        # Anthropic API key secret (must be manually populated after first deploy)
        from aws_cdk import aws_secretsmanager as secretsmanager  # noqa: F811
        anthropic_secret = secretsmanager.Secret.from_secret_name_v2(
            self, "AnthropicApiKeySecret", "percy/anthropic-api-key"
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
                            # Set the Authorized Redirect URI to this URL in Google Cloud
                            # Console after the first deploy completes.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="GOOGLE_OAUTH_REDIRECT_URI",
                                value="https://percy-studio-dev.us-east-1.awsapprunner.com/api/auth/google/callback",
                            ),
                            # ── Bedrock LLM provider (enterprise mode) ─────
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_LLM_PROVIDER", value="bedrock",
                            ),
                            # Default model — switch via this env var without redeploying
                            # code. Override per-call by setting body.context.model.
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_BEDROCK_MODEL",
                                # Cross-region inference profile (preferred) — auto-fails
                                # over across us-east-1 / us-west-2 / us-east-2.
                                value="us.anthropic.claude-sonnet-4-6-20250101-v1:0",
                            ),
                            apprunner.CfnService.KeyValuePairProperty(
                                name="PERCY_BEDROCK_REGION", value=self.region,
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
                egress_configuration=apprunner.CfnService.EgressConfigurationProperty(
                    egress_type="VPC",
                    vpc_connector_arn=vpc_connector.attr_vpc_connector_arn,
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

        worker_service = ecs.FargateService(
            self,
            "OnboardWorkerService",
            cluster=cluster,
            task_definition=worker_task,
            desired_count=0,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PRIVATE_ISOLATED),
            security_groups=[worker_sg],
            assign_public_ip=False,
        )

        # Auto-scale 0→3 based on SQS queue depth
        scalable_target = worker_service.auto_scale_task_count(
            min_capacity=0,
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
        gross_budget_subscribers = [
            budgets.CfnBudget.SubscriberProperty(
                subscription_type="EMAIL", address=alert_email,
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

        CfnOutput(self, "PercyDbSecretArn", value=db.secret.secret_arn)
        CfnOutput(self, "PercyApiKeySecretArn", value=api_key_secret.secret_arn)
        CfnOutput(self, "PercyArtifactsBucket", value=artifacts_bucket.bucket_name)
        CfnOutput(self, "PercyOnboardQueueUrl", value=onboard_queue.queue_url)
        CfnOutput(self, "PercyAlertsTopicArn", value=alerts_topic.topic_arn)
