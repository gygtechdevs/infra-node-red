import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import type { Construct } from 'constructs';
import { getEnabledServices } from './config';

interface AlbStackProps extends StackProps {
  vpc: ec2.Vpc;
  sgAlb: ec2.SecurityGroup;
  services: Record<string, ecs.FargateService>;
  defaultServiceId: string;
  domainName?: string;
}

export class AlbStack extends Stack {
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly httpListener: elbv2.ApplicationListener;
  readonly httpsListener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: AlbStackProps) {
    super(scope, id, props);

    // NO addDependency(ecsStack): attachToApplicationTargetGroup() crea una
    // referencia implícita CfnService (ECS) → listener/TG (ALB); una
    // dependencia explícita ALB→ECS produciría "cyclic reference" en synth.

    const services = getEnabledServices();

    // ── ALB ────────────────────────────────────────────────────────────────
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: props.sgAlb,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // ── Target Groups (uno por servicio) ──────────────────────────────────
    const targetGroups = new Map<string, elbv2.ApplicationTargetGroup>();
    for (const service of services) {
      const tg = new elbv2.ApplicationTargetGroup(this, `Tg-${service.id}`, {
        vpc: props.vpc,
        port: service.port,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: service.healthCheckPath,
          interval: Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        deregistrationDelay: Duration.seconds(30),
      });
      props.services[service.id].attachToApplicationTargetGroup(tg);
      targetGroups.set(service.id, tg);
    }

    const defaultTargetGroup = targetGroups.get(props.defaultServiceId);
    if (!defaultTargetGroup) {
      throw new Error(`Default service '${props.defaultServiceId}' has no target group`);
    }

    // ── Listeners ──────────────────────────────────────────────────────────
    this.httpListener = this.alb.addListener('HttpListener', {
      port: 80,
      defaultAction: props.domainName
        ? elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true })
        : elbv2.ListenerAction.forward([defaultTargetGroup]),
    });

    if (props.domainName) {
      const domainName = props.domainName;

      // Certificado ACM wildcard vía validación DNS.
      const cert = new acm.Certificate(this, 'Cert', {
        domainName,
        subjectAlternativeNames: [`*.${domainName}`],
        validation: acm.CertificateValidation.fromDns(),
      });

      this.httpsListener = this.alb.addListener('HttpsListener', {
        port: 443,
        certificates: [cert],
        defaultAction: elbv2.ListenerAction.forward([defaultTargetGroup]),
      });

      for (const service of services) {
        if (!service.albHosts?.length) continue;
        this.httpsListener.addAction(`Route-${service.id}`, {
          priority: service.albPriority,
          conditions: [
            elbv2.ListenerCondition.hostHeaders(
              service.albHosts.map((host) => host.replace('GATEWAY_DOMAIN', domainName)),
            ),
          ],
          action: elbv2.ListenerAction.forward([targetGroups.get(service.id)!]),
        });
      }
    } else {
      // Sin dominio: enruta por path en el listener HTTP.
      for (const service of services) {
        if (!service.albPaths?.length) continue;
        this.httpListener.addAction(`Route-${service.id}`, {
          priority: service.albPriority,
          conditions: [elbv2.ListenerCondition.pathPatterns(service.albPaths)],
          action: elbv2.ListenerAction.forward([targetGroups.get(service.id)!]),
        });
      }

      this.httpsListener = this.httpListener as unknown as elbv2.ApplicationListener;
    }

    new CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'Apuntar un CNAME *.tudominio.com → este valor',
    });
  }
}
