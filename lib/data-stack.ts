import { Stack, type StackProps, RemovalPolicy, CfnOutput, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

// DB (Neon) y Redis (Redis Cloud) son externos — no se crean aquí.
// Este stack gestiona solo S3 (flows de Node-RED).

interface DataStackProps extends StackProps {
  vpc: ec2.Vpc;
}

export class DataStack extends Stack {
  readonly flowsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

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

    new CfnOutput(this, 'FlowsBucketName', { value: this.flowsBucket.bucketName });
  }
}
