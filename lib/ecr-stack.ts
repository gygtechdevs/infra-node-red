import { Stack, type StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import type { Construct } from 'constructs';
import { getEnabledServices } from './config';

export class EcrStack extends Stack {
  readonly repositories: Record<string, ecr.IRepository>;
  readonly repositoryList: ecr.IRepository[];

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.repositories = {};
    this.repositoryList = [];

    for (const service of getEnabledServices()) {
      const repo = new ecr.Repository(this, `Repo-${service.id}`, {
        repositoryName: service.ecrRepoName,
        // Destroy + empty so the stack can be torn down and recreated; CI rebuilds images.
        removalPolicy: RemovalPolicy.DESTROY,
        emptyOnDelete: true,
        imageScanOnPush: true,
        lifecycleRules: [
          {
            description: 'Keep last 10 images',
            maxImageCount: 10,
          },
        ],
      });

      new CfnOutput(this, `RepoUri-${service.id}`, {
        exportName: `nodered-ecr-${service.id}`,
        value: repo.repositoryUri,
      });

      this.repositories[service.id] = repo;
      this.repositoryList.push(repo);
    }
  }
}
