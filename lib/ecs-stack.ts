import { Stack, type StackProps, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import type { Construct } from 'constructs';
import { getEnabledServices, namespace } from './config';

interface EcsStackProps extends StackProps {
  vpc: ec2.Vpc;
  serviceSecurityGroups: Record<string, ec2.SecurityGroup>;
  repositories: Record<string, ecr.IRepository>;
  secrets: Record<string, import('aws-cdk-lib/aws-secretsmanager').ISecret>;
  redisEndpoint: string;
  flowsBucket: s3.Bucket;
  corsOrigin: string;
}

export class EcsStack extends Stack {
  readonly cluster: ecs.Cluster;
  readonly services: Record<string, ecs.FargateService>;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    // ── Cluster ────────────────────────────────────────────────────────────
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'node-red',
      vpc: props.vpc,
      containerInsights: true,
    });

    // ── Service Discovery: {servicio}.node-red.local ──────────────
    const cloudMapNamespace = new servicediscovery.PrivateDnsNamespace(this, 'Namespace', {
      name: namespace,
      vpc: props.vpc,
    });

    // ── IAM: Task Execution Role (pull ECR + read secrets) ─────────────────
    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    for (const secret of Object.values(props.secrets)) {
      secret.grantRead(executionRole);
    }

    this.services = {};

    for (const service of getEnabledServices(props.corsOrigin)) {
      const repo = props.repositories[service.id];
      if (!repo) {
        throw new Error(`No ECR repository found for service '${service.id}'`);
      }
      const sg = props.serviceSecurityGroups[service.id];
      if (!sg) {
        throw new Error(`No security group found for service '${service.id}'`);
      }

      const taskDef = new ecs.FargateTaskDefinition(this, `Td-${service.id}`, {
        cpu: service.cpu,
        memoryLimitMiB: service.memoryLimitMiB,
        executionRole,
      });

      const secrets: Record<string, ecs.Secret> = {};
      for (const [envVar, secretName] of Object.entries(service.secretEnv)) {
        const secret = props.secrets[secretName];
        if (!secret) {
          throw new Error(`Secret '${secretName}' (env ${envVar}) not found in SecretsStack`);
        }
        secrets[envVar] = ecs.Secret.fromSecretsManager(secret);
      }

      const logGroup = new logs.LogGroup(this, `Log-${service.id}`, {
        logGroupName: `/node-red/${service.id}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      taskDef.addContainer(`Container-${service.id}`, {
        image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
        containerName: service.containerName,
        portMappings: [{ containerPort: service.port }],
        environment: service.env,
        secrets,
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: service.id,
        }),
        healthCheck: {
          command: service.containerHealthCheckCommand ?? [
            'CMD-SHELL',
            `wget -qO- http://localhost:${service.port}${service.healthCheckPath} || exit 1`,
          ],
          interval: Duration.seconds(30),
          timeout: Duration.seconds(5),
          retries: 3,
          startPeriod: Duration.seconds(60),
        },
      });

      const fargateService = new ecs.FargateService(this, `Svc-${service.id}`, {
        cluster: this.cluster,
        taskDefinition: taskDef,
        serviceName: service.ecsServiceName,
        desiredCount: 1,
        securityGroups: [sg],
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        assignPublicIp: true,
        circuitBreaker: { rollback: true },
        enableExecuteCommand: true,
      });

      fargateService.enableCloudMap({
        cloudMapNamespace,
        name: service.ecsServiceName,
      });

      this.services[service.id] = fargateService;
    }
  }
}
