from pathlib import Path

from aws_cdk import CfnOutput, RemovalPolicy, Stack
from aws_cdk import aws_apprunner as apprunner
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_ecr_assets as ecr_assets
from aws_cdk import aws_iam as iam
from aws_cdk import aws_rds as rds
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
        db.secret.grant_read(instance_role)

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
                        ],
                        runtime_environment_secrets=[
                            apprunner.CfnService.KeyValuePairProperty(
                                name="DB_PASSWORD",
                                value=f"{db.secret.secret_arn}:password::",
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

        CfnOutput(
            self,
            "PercyDbSecretArn",
            value=db.secret.secret_arn,
        )
