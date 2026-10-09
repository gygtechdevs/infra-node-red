import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type { Construct } from 'constructs';
import { getEnabledServices } from './config';

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly sgAlb: ec2.SecurityGroup;
  readonly serviceSecurityGroups: Record<string, ec2.SecurityGroup>;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // ── VPC: 2 AZs, sin NAT Gateway ────────────────────────────────────────
    // Las tasks de ECS corren en subnets públicas (con IP pública, SG solo
    // permite ingress desde el ALB). Redis va en subnets aisladas.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'Isolated', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ── Security Groups ────────────────────────────────────────────────────

    this.sgAlb = new ec2.SecurityGroup(this, 'SgAlb', {
      vpc: this.vpc,
      description: 'ALB - public HTTP/HTTPS',
      allowAllOutbound: true,
    });
    this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    this.sgAlb.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    this.serviceSecurityGroups = {};
    for (const service of getEnabledServices()) {
      const sg = new ec2.SecurityGroup(this, `Sg-${service.id}`, {
        vpc: this.vpc,
        description: `${service.ecsServiceName} - ALB ingress`,
        allowAllOutbound: true,
      });
      sg.addIngressRule(this.sgAlb, ec2.Port.tcp(service.port), `ALB to ${service.ecsServiceName}`);
      this.serviceSecurityGroups[service.id] = sg;
    }
  }
}
