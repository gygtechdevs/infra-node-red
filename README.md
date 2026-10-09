# infra-node-red

AWS CDK (TypeScript) infrastructure for the Node-Red platform: `api-gateway` and `auth-service` on ECS Fargate behind an ALB.

- Account / region: `372349310729` / `us-east-1`
- Images: built and pushed to ECR by the service repos' pipelines (tag `latest`)
- Database: Neon PostgreSQL (external)
- Redis: Redis Cloud (external) — no ElastiCache
- No NAT Gateway: tasks run in public subnets with a public IP; the security group only allows ingress from the ALB

## Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Command reference](#command-reference)
4. [Secrets](#secrets)
5. [Deploy](#deploy)
6. [Destroy](#destroy)
7. [CI/CD](#cicd)
8. [Verify and troubleshoot](#verify-and-troubleshoot)
9. [Things to keep in mind](#things-to-keep-in-mind)

## Architecture

| Stack | Purpose |
| --- | --- |
| `NodeRedNetwork` | VPC (2 AZs, public + isolated subnets), ALB and per-service security groups |
| `NodeRedData` | S3 bucket `nodered-flows-<account>` for Node-RED flows (versioned, `RETAIN`) |
| `NodeRedEcr` | ECR repos `node-red/gateway`, `node-red/auth` (keep last 10 images, scan on push) |
| `NodeRedSecrets` | Secrets Manager entries under `/node-red/*` |
| `NodeRedEcs` | Cluster `node-red`, Cloud Map namespace `node-red.local`, Fargate services |
| `NodeRedAlb` | Load balancer, listeners and routing rules |
| `NodeRedGithubOidc` | GitHub OIDC provider and the roles used by CI (see [CI/CD](#cicd)) |

Dependencies: `Data`, `Ecs` → `Network`; `Ecs` → `Data`, `Ecr`, `Secrets`; `Alb` ← `Ecs` (implicit cross-stack reference — do not add an explicit `addDependency`, it causes a cyclic reference); `GithubOidc` ← `Ecr`.

Services are defined in `lib/config.ts` (set `enabled` to turn one on or off).

| Service | ECS name | Port | ALB paths | ECR repo |
| --- | --- | --- | --- | --- |
| `gateway` | `api-gateway` | 8080 | `/api/*`, `/intents*`, `/health` | `node-red/gateway` |
| `auth` | `auth-service` | 4001 | `/api/auth*` | `node-red/auth` |

Source layout: `bin/app.ts` wires the stacks, `lib/*-stack.ts` holds each stack, `lib/config.ts` holds the service catalog.

## Prerequisites

- Node 22 and npm
- AWS CLI v2 and credentials for account `372349310729` (this project uses the profile `admin-gera&guido`)
- The account is CDK-bootstrapped in `us-east-1`; otherwise run `npx cdk bootstrap aws://372349310729/us-east-1` once

```bash
npm ci
export AWS_PROFILE="admin-gera&guido"
aws sts get-caller-identity   # confirm the account before touching anything
```

## Command reference

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run synth` / `npx cdk synth --quiet` | Generate CloudFormation templates |
| `npm run diff` / `npx cdk diff --all` | Show pending changes — **always run before deploying** |
| `npx cdk ls` | List stacks |
| `npm run deploy` | `cdk deploy --all --require-approval never` |
| `npm run destroy` | `cdk destroy --all` (asks for confirmation per stack) |
| `npx cdk deploy <Stack> [<Stack>...]` | Deploy specific stacks |
| `npx cdk destroy <Stack>` | Destroy one stack |

Context flags (append to `synth`, `diff`, `deploy`):

| Flag | Effect |
| --- | --- |
| `-c domainName=example.com` | Host rules `gateway.<domain>` and `auth.<domain>` on the ALB |
| `-c corsOrigin=https://app.example.com` | `CORS_ALLOWED_ORIGINS` for the gateway (default `*`) |

## Secrets

Created by `NodeRedSecrets`. Generated secrets need no action; manual ones must be set with `put-secret-value` after the stack exists.

| Secret | Source |
| --- | --- |
| `/node-red/database-url` | **Manual** — Neon connection string |
| `/node-red/redis-url` | **Manual** — Redis Cloud URL (`redis://default:<pass>@<host>:<port>`) |
| `/node-red/meta-access-token` | Generated placeholder — replace with the real WhatsApp token |
| `/node-red/internal-secret` | Generated |
| `/node-red/auth-jwt-secret` | Generated (used by gateway and auth) |
| `/node-red/auth-refresh-secret` | Generated |
| `/node-red/gateway-intents-api-key` | Generated |
| `/node-red/gateway-internal-api-key` | Generated |

```bash
# Git Bash on Windows: MSYS_NO_PATHCONV=1 stops "/node-red/..." being rewritten as a Windows path
export MSYS_NO_PATHCONV=1

aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id /node-red/database-url \
  --secret-string 'postgresql://<user>:<password>@<host>/<db>?sslmode=require'

aws secretsmanager put-secret-value --region us-east-1 \
  --secret-id /node-red/redis-url \
  --secret-string 'redis://default:<password>@<host>:<port>'
```

Notes:
- Do not use `channel_binding=require` in the Neon URL; some Node drivers (`pg`) do not handle it.
- Never commit connection strings, and rotate any credential that was pasted into a chat or a log.
- Secrets are rewritten when the stack is recreated: after a destroy + deploy the manual ones must be set again.
- Services read secrets at task start. After changing a secret, force a new deployment (see [Verify](#verify-and-troubleshoot)).

## Deploy

### First deploy on a clean account

The order matters: ECS needs images in ECR and populated secrets before its tasks can become healthy.

```bash
export AWS_PROFILE="admin-gera&guido"
npm ci && npm run typecheck

# 1. Registry + CI roles
npx cdk deploy NodeRedEcr NodeRedGithubOidc
#    -> copy CdkDeployRoleArn into the GitHub secret AWS_ROLE_ARN of this repo
#    -> run the service pipelines (gateway and auth) so they push :latest

# 2. Base infrastructure
npx cdk deploy NodeRedNetwork NodeRedData NodeRedSecrets

# 3. Manual secrets (see Secrets): database-url, redis-url, meta-access-token

# 4. Everything else
npx cdk diff --all
npx cdk deploy --all --require-approval never
```

Check that the images exist before step 4:

```bash
aws ecr list-images --repository-name node-red/gateway --region us-east-1
aws ecr list-images --repository-name node-red/auth --region us-east-1
```

The first deploy of `NodeRedGithubOidc` has to run locally: the role that CI assumes is created by that same stack.

### Regular deploys

Push to `main` (the workflow deploys), or locally:

```bash
npm run typecheck && npx cdk diff --all && npm run deploy
```

Do not pipe `cdk deploy` into `head` or similar: closing the pipe kills the CLI mid-deploy and leaves a stack in `REVIEW_IN_PROGRESS`. Redirect to a file instead (`npx cdk deploy ... > deploy.log 2>&1`).

## Destroy

```bash
export AWS_PROFILE="admin-gera&guido"
npx cdk destroy --all            # prompts per stack; add --force to skip the prompts
```

CDK resolves the reverse dependency order itself. What disappears:

| Stack | Effect |
| --- | --- |
| `NodeRedEcr` | Repos **and their images** are deleted (`emptyOnDelete`). Service pipelines must push `:latest` again |
| `NodeRedSecrets` | All secrets deleted, including the manual ones — set them again after redeploying |
| `NodeRedGithubOidc` | CI roles and the OIDC provider are deleted. After recreating it, update `AWS_ROLE_ARN` in GitHub |
| `NodeRedData` | The flows bucket is **retained** (`RETAIN`), so it stays in the account |
| `NodeRedNetwork`, `NodeRedEcs`, `NodeRedAlb` | Removed |

Remove the retained bucket (only after confirming its contents are disposable):

```bash
aws s3api list-object-versions --bucket nodered-flows-372349310729 --max-items 5   # confirm it is empty
aws s3api delete-bucket --bucket nodered-flows-372349310729
```

If it still has objects or versions, empty it first (`aws s3 rm s3://nodered-flows-372349310729 --recursive` plus the versions and delete markers). Do this before redeploying `NodeRedData`, or the next deploy fails.

Verify nothing is left:

```bash
aws cloudformation list-stacks --region us-east-1 \
  --query 'StackSummaries[?starts_with(StackName,`NodeRed`) && StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output text
aws secretsmanager list-secrets --region us-east-1 --query 'SecretList[?starts_with(Name,`/node-red/`)].Name' --output text
aws ecr describe-repositories --region us-east-1 --query 'repositories[?starts_with(repositoryName,`node-red/`)].repositoryName' --output text
```

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `.github/workflows/pr.yml` | PR to `main` | `npm ci`, `typecheck`, `cdk synth` |
| `.github/workflows/deploy.yml` | push to `main`, `workflow_dispatch`, `repository_dispatch` (`image-pushed`) | OIDC login, `synth`, `diff`, `cdk deploy --all`, force new ECS deployment, wait for stable |

Roles created by `NodeRedGithubOidc`:

| Role | Assumed by | Used for |
| --- | --- | --- |
| `nodered-cdk-deploy` | `gygtechdevs/infra-node-red` @ `main` | This repo's deploy workflow. ARN goes in the GitHub secret `AWS_ROLE_ARN` |
| `nodered-image-builder` | `gygtechdevs/apigateway-node-red` and `gygtechdevs/auth-node-red` @ `main` | Push images to the two ECR repos |

The `sub` claim must match exactly, including the GitHub organization and repository names. If a pipeline fails with `Not authorized to perform sts:AssumeRoleWithWebIdentity`, check the repo name and branch against `lib/github-oidc-stack.ts`.

## Verify and troubleshoot

```bash
# Service health
aws ecs describe-services --cluster node-red --services api-gateway auth-service \
  --region us-east-1 --query 'services[].[serviceName,runningCount,desiredCount]'

# ALB address and target health
aws elbv2 describe-load-balancers --region us-east-1 --query 'LoadBalancers[].DNSName' --output text
curl http://<alb-dns>/health

# Force a new deployment (pick up a new :latest image or a changed secret)
aws ecs update-service --cluster node-red --service api-gateway --force-new-deployment --region us-east-1
aws ecs update-service --cluster node-red --service auth-service --force-new-deployment --region us-east-1

# Logs
aws logs tail --follow <log-group-name> --region us-east-1
```

| Symptom | Likely cause |
| --- | --- |
| Tasks stop with `CannotPullContainerError` | No `:latest` tag in ECR yet |
| Tasks stop with a secrets error | A referenced `/node-red/*` secret does not exist or is empty |
| `NodeRedData` fails with `AWS::EarlyValidation::ResourceExistenceCheck` | The retained bucket `nodered-flows-<account>` already exists (see [Destroy](#destroy)) |
| Stack stuck in `REVIEW_IN_PROGRESS` | A previous deploy was interrupted; delete the stack (`aws cloudformation delete-stack`) and redeploy |
| `Invalid name` from `put-secret-value` on Windows | Git Bash path conversion; set `MSYS_NO_PATHCONV=1` |
| `/intents*` or platform routes return 5xx | `intents-service` / `platform-backend` are not deployed (see below) |

## Things to keep in mind

- `gateway` calls `intents-service` (`:4002`) and `platform-backend` (`:3000`) via Cloud Map. Neither exists yet; add them to `lib/config.ts` to enable those routes. `/health` and `/api/auth*` work without them.
- Without a `domainName` context, host-based ALB rules use the literal `GATEWAY_DOMAIN` placeholder. Pass the real domain on deploy.
- ECS pins `fromEcrRepository(repo, 'latest')`. A new image only reaches running tasks after a forced deployment (the deploy workflow does this).
- Tasks have public IPs and no NAT. This keeps cost low and gives outbound access to Neon and Redis Cloud, but it means the security group is the only network boundary.
- The deploy role grants broad permissions (`iam:*`, `s3:*`, `ec2:*`, ...) on `*`. Tighten it before using this setup for production.
- Region is hardcoded to `us-east-1` in `bin/app.ts`; the account comes from `CDK_DEFAULT_ACCOUNT` (your active AWS profile).
- Removing a service from `lib/config.ts` (or setting `enabled: false`) also removes its ECR repo and its images on the next deploy.
