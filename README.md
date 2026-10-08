# infra-node-red

Infraestructura CDK (AWS) de la plataforma Node-RED. **Fase 1**: dos servicios ECS Fargate detrás de un ALB.

| Servicio | ECS | Puerto | Rutas ALB (sin dominio) | Prioridad |
|---|---|---|---|---|
| auth | `auth-service` | 4001 | `/api/auth*` | 10 |
| gateway | `api-gateway` | 8080 | `/api/*`, `/intents*`, `/health` (default) | 20 |

Stacks: Network (VPC + SG) → Data (Redis + S3) → ECR → Secrets → ECS (cluster, tareas, Cloud Map `node-red.local`) → ALB → GitHub OIDC.

## Requisitos previos

1. CDK bootstrap en la cuenta/region: `npx cdk bootstrap`
2. Secretos de GitHub en este repo:
   - `AWS_ROLE_ARN` → ARN del output `CdkDeployRoleArn` (workflow deploy).
3. Secretos de GitHub en los repos de servicios:

   | Repo | Secretos |
   |---|---|
   | `node-red-api-gateway` | `AWS_ROLE_ARN` (output `ImageBuilderRoleArn`), `ECR_REPOSITORY=node-red/gateway`, `INFRA_DISPATCH_TOKEN` (PAT con scope `repo` sobre este repo) |
   | `node-red-auth` | ídem con `ECR_REPOSITORY=node-red/auth`, más `DATABASE_URL` (para `migrate:up`) |

4. Poblar los dos secretos vacíos a mano tras el primer deploy:

```bash
aws secretsmanager put-secret-value \
  --secret-id /node-red/database-url \
  --secret-string "postgresql://postgres.[ref]:[pwd]@...pooler.supabase.com:6543/postgres"

aws secretsmanager put-secret-value \
  --secret-id /node-red/redis-url \
  --secret-string "rediss://<endpoint>:6379"
```

## Comandos

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run synth       # cdk synth
npm run deploy      # cdk deploy --all --require-approval never
npm run destroy     # cdk destroy --all
```

Contexto (en `cdk.json`): `domainName` (`null` = modo sin dominio, rutas por path) y `corsOrigin`.

## Agregar un servicio (fase 2)

Editar **solo** `lib/config.ts`: agregar una entrada a `getServices()` con `enabled: true`. Network (SG), ECR (repo), ECS (task/service) y ALB (TG/reglas) se derivan automáticamente. Los hosts usan el placeholder `GATEWAY_DOMAIN` que se reemplaza cuando `domainName` tiene valor.

## Flujo de despliegue

1. Push al repo del servicio → build de imagen → push a ECR (rol `nodered-image-builder`).
2. El workflow del servicio dispara `repository_dispatch` tipo `image-pushed`.
3. Este repo, en `main` → `Deploy infrastructure`: typecheck, synth, `cdk deploy --all`.
4. `force new deployment` + `wait services-stable` para que ECS tire la imagen nueva.

Los PRs corren solo `typecheck` + `synth` (sin credenciales AWS: el trust policy solo permite `ref:refs/heads/main`).
