import type { App } from 'aws-cdk-lib';

export interface ServiceDef {
  id: string;
  ecsServiceName: string;
  containerName: string;
  ecrRepoName: string;
  port: number;
  cpu: number;
  memoryLimitMiB: number;
  healthCheckPath: string;
  containerHealthCheckCommand?: string[];
  env: Record<string, string>;
  secretEnv: Record<string, string>;
  albPaths?: string[];
  albHosts?: string[];
  albPriority: number;
  enabled: boolean;
}

export const clusterName = 'node-red';
export const namespace = 'node-red.local';
export const defaultServiceId = 'gateway';

export function resolveDomainName(app: App): string | undefined {
  const value = app.node.tryGetContext('domainName');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function resolveCorsOrigin(app: App): string {
  const value = app.node.tryGetContext('corsOrigin');
  return typeof value === 'string' && value.length > 0 ? value : '*';
}

export function getServices(corsOrigin = '*'): ServiceDef[] {
  return [
    {
      id: 'gateway',
      ecsServiceName: 'api-gateway',
      containerName: 'gateway',
      ecrRepoName: 'node-red/gateway',
      port: 8080,
      cpu: 256,
      memoryLimitMiB: 512,
      healthCheckPath: '/health',
      env: {
        NODE_ENV: 'production',
        PORT: '8080',
        LOG_LEVEL: 'info',
        CORS_ALLOWED_ORIGINS: corsOrigin,
        TRUST_PROXY: '1',
        INTENTS_SERVICE_URL: 'http://intents-service.node-red.local:4002',
        INTENTS_TIMEOUT_MS: '5000',
        PLATFORM_BACKEND_BASE_URL: 'http://platform-backend.node-red.local:3000',
        PLATFORM_BACKEND_TIMEOUT_MS: '5000',
        RATE_LIMIT_WINDOW_MS: '60000',
        RATE_LIMIT_MAX: '300',
      },
      secretEnv: {
        REDIS_URL: '/node-red/redis-url',
        INTENTS_INTERNAL_SECRET: '/node-red/gateway-intents-api-key',
        NODE_RED_INTERNAL_API_KEY: '/node-red/gateway-internal-api-key',
        AUTH_JWT_SECRET: '/node-red/auth-jwt-secret',
        META_ACCESS_TOKEN: '/node-red/meta-access-token',
      },
      albPaths: ['/api/*', '/intents*', '/health'],
      albHosts: ['gateway.GATEWAY_DOMAIN'],
      albPriority: 20,
      enabled: true,
    },
    {
      id: 'auth',
      ecsServiceName: 'auth-service',
      containerName: 'auth',
      ecrRepoName: 'node-red/auth',
      port: 4001,
      cpu: 256,
      memoryLimitMiB: 512,
      healthCheckPath: '/health',
      env: {
        NODE_ENV: 'production',
        PORT: '4001',
        LOG_LEVEL: 'info',
        JWT_EXPIRES_IN: '15m',
        REFRESH_TOKEN_TTL_DAYS: '7',
        BCRYPT_COST: '12',
      },
      secretEnv: {
        DATABASE_URL: '/node-red/database-url',
        JWT_SECRET: '/node-red/auth-jwt-secret',
        INTERNAL_SECRET: '/node-red/internal-secret',
      },
      albPaths: ['/api/auth*'],
      albHosts: ['auth.GATEWAY_DOMAIN'],
      albPriority: 10,
      enabled: true,
    },
  ];
}

export function getEnabledServices(corsOrigin?: string): ServiceDef[] {
  return getServices(corsOrigin).filter((service) => service.enabled);
}
