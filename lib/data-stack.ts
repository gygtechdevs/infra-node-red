import { Stack, type StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

// DB: Supabase (externo) — no se crea RDS aquí.
// Este stack gestiona Redis (sesiones) y S3 (flows de Node-RED).

interface DataStackProps extends StackProps {
  vpc: ec2.Vpc;
  redisSecurityGroup: ec2.SecurityGroup;
}

export class DataStack extends Stack {
  readonly redisEndpoint: string;
  readonly flowsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // ── ElastiCache Redis — sesiones del gateway ───────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Private subnets for gateway session store',
      subnetIds: props.vpc.isolatedSubnets.map((s) => s.subnetId),
    });

    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: 'nodered-gateway-sessions',
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      engineVersion: '7.1',
      numCacheClusters: 1, // MVP: single node, sin HA
      automaticFailoverEnabled: false,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [props.redisSecurityGroup.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
      transitEncryptionMode: 'required',
    });
    redis.addDependency(redisSubnetGroup);

    // CDK no expone el endpoint directamente desde CfnReplicationGroup
    // cuando numCacheClusters=1 — lo construimos manualmente.
    this.redisEndpoint = `rediss://${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}`;

    // ── S3 — flows de Node-RED ─────────────────────────────────────────────
    this.flowsBucket = new s3.Bucket(this, 'FlowsBucket', {
      bucketName: `nodered-flows-${this.account}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // El original usaba noncurrentVersionExpiration: undefined +
          // noncurrentVersionsToRetain: 30, lo que renderizaba una regla
          // vacía. En aws-cdk-lib 2.170 el campo L2 es un Duration y
          // newerNoncurrentVersions sale de noncurrentVersionsToRetain.
          id: 'expire-noncurrent-versions',
          noncurrentVersionExpiration: Duration.days(30),
          noncurrentVersionsToRetain: 30,
        },
      ],
    });

    new CfnOutput(this, 'RedisEndpoint', { value: this.redisEndpoint });
    new CfnOutput(this, 'FlowsBucketName', { value: this.flowsBucket.bucketName });
  }
}
