import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * The stack uses only managed HTTPS/WSS endpoints, so a custom domain is not
 * required. It creates billable cloud resources; review `cdk diff` before any
 * deployment and never treat the AWS Free plan as proof that every service is
 * enabled or covered.
 */
export class LiveLessonLabServerlessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The table stores routing state only: one short-lived room row and one
    // membership row per connected browser. It never stores camera or audio data.
    const roomTable = new dynamodb.Table(this, "RoomState", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // One Lambda receives WebSocket connect, disconnect, and signaling events.
    // Keeping routing logic in one function makes the first serverless version
    // easier to learn; the DynamoDB rows provide the state that memory used to hold.
    const signalingHandler = new nodejs.NodejsFunction(this, "SignalingHandler", {
      entry: path.join(__dirname, "../../../services/aws-signaling/src/handler.ts"),
      // The Lambda lives in the root npm workspace, outside infra/aws. Point
      // CDK at the monorepo root so it can bundle the shared workspace package.
      projectRoot: path.join(__dirname, "../../.."),
      depsLockFilePath: path.join(__dirname, "../../../package-lock.json"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: { ROOMS_TABLE: roomTable.tableName },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: []
      }
    });
    roomTable.grantReadWriteData(signalingHandler);

    const socketApi = new apigateway.WebSocketApi(this, "SignalingApi", {
      description: "Private lesson signaling; WebRTC media stays in the browsers",
      routeSelectionExpression: "$request.body.type",
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("ConnectIntegration", signalingHandler)
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("DisconnectIntegration", signalingHandler)
      },
      // One default route keeps the shared JSON protocol intact. The Lambda
      // validates message types and applies teacher/student-specific rules.
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration("MessageIntegration", signalingHandler)
      }
    });

    const stage = new apigateway.WebSocketStage(this, "ProductionStage", {
      webSocketApi: socketApi,
      stageName: "prod",
      autoDeploy: true
    });

    // A managed HTTPS static origin serves Vite's build. Objects stay private
    // in S3; CloudFront uses Origin Access Control to read them.
    const siteBucket = new s3.Bucket(this, "WebAppAssets", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const distribution = new cloudfront.Distribution(this, "WebAppDistribution", {
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: new cloudfront.ResponseHeadersPolicy(this, "WebSecurityHeaders", {
          securityHeadersBehavior: {
            contentTypeOptions: { override: true },
            frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
            referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
            strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), override: true },
            contentSecurityPolicy: {
              contentSecurityPolicy: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss://${socketApi.apiId}.execute-api.${this.region}.${this.urlSuffix}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
              override: true
            }
          }
        })
      }
    });

    // OIDC creation is denied by the current AWS Organizations policy. Keep
    // this optional so unrelated application fixes can still be deployed.
    // Enable explicitly after the organization administrator resolves the deny.
    if (this.node.tryGetContext("enableGithubDeploy") === "true") {
      // GitHub Actions gets short-lived credentials through OIDC instead of a
      // permanent AWS access key stored in GitHub. The subject condition limits
      // access to pushes from this repository's main branch only.
      const githubProvider = new iam.CfnOIDCProvider(this, "GitHubActionsProvider", {
        url: "https://token.actions.githubusercontent.com",
        clientIdList: ["sts.amazonaws.com"]
      });
      const githubDeployRole = new iam.Role(this, "GitHubActionsDeployRole", {
        roleName: "LiveLessonLabGitHubDeployRole",
        assumedBy: new iam.FederatedPrincipal(
          githubProvider.attrArn,
          {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": "repo:assafbm/live-lesson-lab:ref:refs/heads/main"
            }
          },
          "sts:AssumeRoleWithWebIdentity"
        ),
        description: "Publishes the Live Lesson Lab web build from the main branch"
      });
      githubDeployRole.addToPolicy(new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [siteBucket.bucketArn]
      }));
      githubDeployRole.addToPolicy(new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:AbortMultipartUpload"],
        resources: [siteBucket.arnForObjects("*")]
      }));
      githubDeployRole.addToPolicy(new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [distribution.distributionArn]
      }));

      new cdk.CfnOutput(this, "GitHubActionsDeployRoleArn", {
        value: githubDeployRole.roleArn,
        description: "Set this as the AWS_ROLE_ARN repository variable in GitHub"
      });
    }

    // Scope connection-management access to this API, stage, account and region.
    signalingHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ["execute-api:ManageConnections"],
      resources: [
        `arn:${this.partition}:execute-api:${this.region}:${this.account}:${socketApi.apiId}/${stage.stageName}/POST/@connections/*`
      ]
    }));

    cdk.Tags.of(this).add("Project", "LiveLessonLab");
    cdk.Tags.of(this).add("Environment", "pilot");

    new cdk.CfnOutput(this, "WebsiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "AWS-managed HTTPS address for the teacher and student web app"
    });
    new cdk.CfnOutput(this, "WebSocketUrl", {
      value: stage.url,
      description: "Secure WebSocket endpoint used by VITE_SIGNALING_URL"
    });
    new cdk.CfnOutput(this, "WebAppBucketName", {
      value: siteBucket.bucketName,
      description: "Upload the built Vite files here after setting VITE_SIGNALING_URL"
    });
    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "Use this ID to invalidate cached assets after a web release"
    });
    new cdk.CfnOutput(this, "RoomTableName", {
      value: roomTable.tableName,
      description: "Temporary signaling room state with DynamoDB TTL"
    });
  }
}
