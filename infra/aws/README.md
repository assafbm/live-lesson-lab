# AWS serverless pilot

See [the first deployment review](../../docs/aws-first-deployment-review.md)
for the resource inventory, cost drivers, account-plan checks, and deployment
gates.

This CDK stack is designed for the AWS project `Fresh Deploy` in
`eu-north-1`. It does not require a custom domain. It creates:

- API Gateway WebSocket API for teacher/student signaling.
- One Lambda handler for connect, disconnect, and validated protocol messages.
- A DynamoDB table with TTL for short-lived room and connection membership.
- A private S3 bucket and CloudFront distribution for the React/Vite build.

WebRTC audio and video remain in the browsers. The signaling handler only
routes offers, answers, ICE candidates, and room state. TURN is not configured
in this stack; some restrictive networks may still need a separately reviewed
TURN relay.

## Learning the pieces

- API Gateway owns the long-lived browser WebSocket connections.
- Lambda runs briefly when a browser connects, disconnects, or sends a message.
- DynamoDB replaces the Node server's in-memory room map. It stores only room
  membership and connection IDs, and expires idle rows using TTL.
- S3 stores the built static web files. CloudFront serves them over HTTPS using
  an AWS-managed hostname; the bucket itself stays private.

The AWS CLI must use the `Fresh Deploy` project account and `eu-north-1` region.
The project owner has confirmed the account identity. The CLI is installed at
the standard user path on the owner's computer; deployment commands should be
run from a PowerShell session where `aws sts get-caller-identity` succeeds.

## Local preparation

Use Node.js 22 or newer. Install workspace dependencies and compile the shared
protocol and Lambda package:

```powershell
npm install
npm run build --workspace @live-lesson-lab/shared
npm run build --workspace @live-lesson-lab/aws-signaling
```

Install the CDK tool dependencies and synthesize the CloudFormation template:

```powershell
cd infra/aws
npm install
npm run build
npm run synth
```

`npm run synth` creates a local template only. It does not contact AWS or create
resources. `npm run diff` contacts AWS to compare deployed infrastructure and
is read-only. `cdk bootstrap` and `npm run deploy` create or change AWS
resources; review their proposed changes and current service eligibility first.

## Deployment sequence, after cost review

The first deployment creates the API and an empty website bucket. The stack
outputs the WebSocket URL, website bucket name, CloudFront address, and
distribution ID. Build the web app with the output URL so the browser knows
which secure WebSocket endpoint to connect to:

```powershell
$env:VITE_SIGNALING_URL = "<WebSocketUrl stack output>"
npm run build --workspace @live-lesson-lab/web
aws s3 sync apps/web/dist "s3://<WebAppBucketName stack output>" --delete
aws cloudfront create-invalidation --distribution-id "<CloudFrontDistributionId stack output>" --paths "/*"
```

The placeholders must be replaced with the outputs from the deployed stack.
Do not commit the generated endpoint into source control; it is environment
configuration, not a credential. The endpoint is public by design, so the
server still needs room admission controls before unrelated users are invited.

## Cost and access boundaries

The AWS Free plan is time-limited and restricts which services can be used.
AWS resources can also have quotas and charges. Review the current plan, region,
CloudFormation changes, and service pricing before bootstrapping or deploying.
The stack does not provision TURN, authentication, lesson recording, or a
permanent lesson-history database. Do not use real student details until
teacher authentication, expiring invitations, rate limits, and a TURN plan are
implemented.

The previous EC2 experiment was removed from the active stack because it
required custom DNS and proposed Kinesis Video Streams for TURN. AWS lists
Kinesis Video Streams outside the Free Tier.
