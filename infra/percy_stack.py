from pathlib import Path

from aws_cdk import BundlingOptions, CfnOutput, Duration, RemovalPolicy, Stack
from aws_cdk import aws_applicationautoscaling as autoscaling
from aws_cdk import aws_apprunner as apprunner
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
from aws_cdk import aws_sqs as sqs
from constructs import Construct


class PercyCloudDemoStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

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
        # Observability — CloudWatch alarms
        # ------------------------------------------------------------------
        alerts_topic = sns.Topic(self, "PercyAlerts", display_name="Percy Dev Alerts")

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
