# First AWS Deployment Review

## Scope

This review covers the first hosted pilot in `eu-north-1`: one teacher, one
student, a static React/Vite site, and signaling for a peer-to-peer WebRTC call.
It does not include recording, TURN relays, authentication, or multiple students.

No AWS resources have been created. `cdk synth` only generated a local
CloudFormation template. The current CDK `minimatch` advisory is recorded as a
toolchain risk; the installed `aws-cdk-lib` currently has no upstream fix.

## What the deployment creates

| Resource | Purpose | Main cost driver |
| --- | --- | --- |
| CDK bootstrap stack (`CDKToolkit`) | Stages deployment assets and grants CDK deployment roles. The standard bootstrap includes an S3 asset bucket, IAM roles, SSM version metadata, and an ECR repository. | Stored assets in S3 or ECR; normally small for this project. |
| CloudFront distribution | Serves the web app over HTTPS on an AWS-managed hostname. The S3 origin remains private. | Requests and data served. Check which CloudFront pricing model the account and distribution use. |
| Private S3 web bucket | Holds the built static files. | Stored data and requests. It is not a public bucket. |
| API Gateway WebSocket API | Carries room signaling between teacher and student browsers. | Connected minutes and signaling messages. AWS meters messages in 32 KB increments. |
| Lambda function | Handles connect, disconnect, room, and signaling events. It is configured for 256 MB and a 10-second maximum invocation. | Number and duration of invocations. |
| DynamoDB on-demand table | Stores short-lived room membership and connection IDs, with TTL expiry. | Reads, writes, and stored bytes. TTL deletion is asynchronous; the handler also checks expiry. |
| IAM roles and CloudWatch logs | Give the handler access to the table and WebSocket callback API, and retain operational logs. | Log ingestion and retention if logs accumulate. |

WebRTC audio and video travel directly between browsers in the current design;
AWS carries signaling, not the lesson media. If a TURN relay is added later,
some media will travel through relay infrastructure and the cost profile will
change.

## Cost and Free plan notes

There is no reliable fixed monthly estimate before we know site traffic,
connection durations, and message volume. For a small pilot, the most visible
variable items are CloudFront traffic and API Gateway WebSocket connection
minutes/messages. Lambda and DynamoDB are usage-based at this scale. Recording
and TURN are deliberately excluded because both can add substantial storage or
data-transfer costs.

AWS currently describes the Free account plan as lasting up to six months or
until credits are exhausted, whichever happens first. It gives access to a
subset of services; after the plan ends, AWS suspends the account and its
resources unless the account is upgraded. Check the Billing console for this
account's remaining credits, expiry date, and access to each service before
bootstrapping. Do not assume that the Free plan means every proposed service is
available or that a production service will stay online after the plan ends.

Recommended cost checks before deployment:

1. Review remaining credit and expiry in the AWS Billing and Cost Management
   console.
2. Confirm the Free plan permits CloudFront, S3, API Gateway WebSocket, Lambda,
   and DynamoDB in this account and region.
3. Create a monthly AWS Budget and an email alert. Budgets notify; they are not
   a hard spending cap.
4. After bootstrap and after application deployment, inspect the CloudFormation
   change set and verify resource names and region.
5. Review the billing dashboard after the first test lesson.

## Operational and safety limits

- The WebSocket endpoint is public and currently has no user authentication,
  expiring invitation token, or application-level rate limit. Anyone who gets a
  lesson link can attempt to join it. Do not use real student details or
  advertise the endpoint publicly yet.
- A random room ID reduces accidental discovery but is not a substitute for
  authentication or access controls.
- CloudFront's HTTPS site and API Gateway's WSS endpoint do not require a custom
  domain, but this does not solve identity, admission, or TURN relay needs.
- The lesson media is peer-to-peer. Some school, corporate, or mobile networks
  may block direct paths; those sessions may fail until a TURN option is added.
- The AWS account is on a time-limited Free plan. A pilot must be migrated to a
  paid plan before the Free plan expires if it is expected to remain available.

## Deployment gates

The local checks currently pass: workspace type checks/builds, CDK TypeScript
build, and CDK synthesis. Before creating AWS resources:

1. Review and accept the resource and Free plan constraints above.
2. Confirm the AWS CLI identity and region are the intended project account and
   `eu-north-1`.
3. Run CDK bootstrap, then inspect its `CDKToolkit` resources.
4. Review the application stack diff, then deploy the stack.
5. Build the web app with the deployed WSS URL, upload it to the private S3
   bucket, and test the teacher/student flow through CloudFront.

## AWS references

- [AWS Free account plan details](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html)
- [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)
- [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/)
- [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/)
- [Lambda pricing](https://aws.amazon.com/lambda/pricing/)
- [DynamoDB pricing](https://aws.amazon.com/dynamodb/pricing/)
- [AWS Budgets pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)
