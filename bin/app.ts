#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { EcrStack } from '../lib/ecr-stack';
import { SecretsStack } from '../lib/secrets-stack';
import { EcsStack } from '../lib/ecs-stack';
import { AlbStack } from '../lib/alb-stack';
import { GithubOidcStack } from '../lib/github-oidc-stack';
import { defaultServiceId, resolveCorsOrigin, resolveDomainName } from '../lib/config';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: 'us-east-1',
};

const domainName = resolveDomainName(app);
const corsOrigin = resolveCorsOrigin(app);

// ─── Stacks ───────────────────────────────────────────────────────────────────

const networkStack = new NetworkStack(app, 'NodeRedNetwork', { env });

const dataStack = new DataStack(app, 'NodeRedData', {
  env,
  vpc: networkStack.vpc,
  redisSecurityGroup: networkStack.sgRedis,
});

const ecrStack = new EcrStack(app, 'NodeRedEcr', { env });

const secretsStack = new SecretsStack(app, 'NodeRedSecrets', { env });

const ecsStack = new EcsStack(app, 'NodeRedEcs', {
  env,
  vpc: networkStack.vpc,
  serviceSecurityGroups: networkStack.serviceSecurityGroups,
  repositories: ecrStack.repositories,
  secrets: secretsStack.secrets,
  redisEndpoint: dataStack.redisEndpoint,
  flowsBucket: dataStack.flowsBucket,
  corsOrigin,
});

const albStack = new AlbStack(app, 'NodeRedAlb', {
  env,
  vpc: networkStack.vpc,
  sgAlb: networkStack.sgAlb,
  services: ecsStack.services,
  defaultServiceId,
  domainName,
});

new GithubOidcStack(app, 'NodeRedGithubOidc', {
  env,
  repositoryArns: ecrStack.repositoryList.map((repo) => repo.repositoryArn),
});

// Dependencias explícitas.
// OJO: NO albStack.addDependency(ecsStack) — attachToApplicationTargetGroup()
// ya crea la referencia cross-stack; hacerlo explícito rompe synth con
// "cyclic reference".
dataStack.addDependency(networkStack);
ecsStack.addDependency(networkStack);
ecsStack.addDependency(dataStack);
ecsStack.addDependency(ecrStack);
ecsStack.addDependency(secretsStack);

Tags.of(app).add('project', 'node-red');
Tags.of(app).add('managed-by', 'cdk');

app.synth();
