import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

interface GithubOidcStackProps extends StackProps {
  repositoryArns: string[];
}

export class GithubOidcStack extends Stack {
  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);

    // ── OIDC Provider (uno por cuenta AWS, idempotente) ────────────────────
    const oidcProvider = new iam.OpenIdConnectProvider(this, 'GithubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      // SHA-1 del certificado intermedio de GitHub Actions OIDC
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    // ── Role: deploy de infraestructura (este repo, rama main) ─────────────
    const deployRole = new iam.Role(this, 'CdkDeployRole', {
      roleName: 'nodered-cdk-deploy',
      description: 'CDK deploy from GitHub Actions (gygtechdevs/infra-node-red @ main)',
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub':
            'repo:gygtechdevs/infra-node-red:ref:refs/heads/main',
        },
      }),
    });

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CloudFormation',
      actions: ['cloudformation:*', 'sts:GetCallerIdentity', 'sts:AssumeRole', 'ssm:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'CdkStorage',
      actions: ['s3:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Network',
      actions: ['ec2:*', 'elasticloadbalancing:*', 'servicediscovery:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Containers',
      actions: ['ecs:*', 'ecr:*', 'logs:*', 'elasticache:*', 'acm:*', 'route53:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'Secrets',
      actions: ['secretsmanager:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'IamCreate',
      actions: ['iam:*'],
      resources: ['*'],
    }));

    deployRole.addToPolicy(new iam.PolicyStatement({
      sid: 'PassTaskRole',
      actions: ['iam:PassRole'],
      resources: ['*'],
      conditions: {
        StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
      },
    }));

    // ── Role: push de imágenes desde los repos de servicios ────────────────
    const builderRole = new iam.Role(this, 'ImageBuilderRole', {
      roleName: 'nodered-image-builder',
      description: 'ECR image push from GitHub Actions (service repos @ main)',
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            'repo:gygtechdevs/apigateway-node-red:ref:refs/heads/main',
            'repo:gygtechdevs/node-red-auth:ref:refs/heads/main',
          ],
        },
      }),
    });

    builderRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ECRAuth',
      actions: ['ecr:GetAuthorizationToken'],
      resources: ['*'],
    }));

    builderRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ECRPush',
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'ecr:InitiateLayerUpload',
        'ecr:UploadLayerPart',
        'ecr:CompleteLayerUpload',
        'ecr:PutImage',
      ],
      resources: props.repositoryArns,
    }));

    new CfnOutput(this, 'CdkDeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Valor para el secret AWS_ROLE_ARN del workflow Deploy infrastructure',
    });

    new CfnOutput(this, 'ImageBuilderRoleArn', {
      value: builderRole.roleArn,
      description: 'Rol para push de imágenes desde los repos de servicios (apigateway-node-red / node-red-auth)',
    });
  }
}
