import { Stack, type StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export class SecretsStack extends Stack {
  readonly secrets: Record<string, secretsmanager.ISecret>;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Los dos secretos vacíos se pueblan a mano después del deploy:
    //   aws secretsmanager put-secret-value \
    //     --secret-id /node-red/database-url \
    //     --secret-string "postgresql://..."
    const databaseUrl = new secretsmanager.Secret(this, 'DatabaseUrl', {
      secretName: '/node-red/database-url',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'Supabase PostgreSQL connection string — populate manually with put-secret-value',
    });

    const redisUrl = new secretsmanager.Secret(this, 'RedisUrl', {
      secretName: '/node-red/redis-url',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'ElastiCache Redis URL for gateway sessions (rediss://...) — populate manually',
    });

    const internalSecret = new secretsmanager.Secret(this, 'InternalSecret', {
      secretName: '/node-red/internal-secret',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'X-Internal-Secret header value for inter-service auth',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const authJwtSecret = new secretsmanager.Secret(this, 'AuthJwtSecret', {
      secretName: '/node-red/auth-jwt-secret',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'JWT signing secret for auth-service access tokens',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const authRefreshSecret = new secretsmanager.Secret(this, 'AuthRefreshSecret', {
      secretName: '/node-red/auth-refresh-secret',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'Refresh token signing secret for auth-service',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    const gatewayIntentsApiKey = new secretsmanager.Secret(this, 'GatewayIntentsApiKey', {
      secretName: '/node-red/gateway-intents-api-key',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'API key the gateway uses to call intents-service',
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
      },
    });

    const gatewayInternalApiKey = new secretsmanager.Secret(this, 'GatewayInternalApiKey', {
      secretName: '/node-red/gateway-internal-api-key',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'Internal API key shared with platform-backend / Node-RED',
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
      },
    });

    // Placeholder value so the gateway can boot. Replace with the real Meta token:
    //   aws secretsmanager put-secret-value --secret-id /node-red/meta-access-token --secret-string <token>
    const metaAccessToken = new secretsmanager.Secret(this, 'MetaAccessToken', {
      secretName: '/node-red/meta-access-token',
      removalPolicy: RemovalPolicy.DESTROY,
      description: 'WhatsApp Graph API access token - TEMPORARY placeholder, replace with the real token',
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
      },
    });

    this.secrets = {
      '/node-red/meta-access-token': metaAccessToken,
      '/node-red/database-url': databaseUrl,
      '/node-red/redis-url': redisUrl,
      '/node-red/internal-secret': internalSecret,
      '/node-red/auth-jwt-secret': authJwtSecret,
      '/node-red/auth-refresh-secret': authRefreshSecret,
      '/node-red/gateway-intents-api-key': gatewayIntentsApiKey,
      '/node-red/gateway-internal-api-key': gatewayInternalApiKey,
    };
  }
}
