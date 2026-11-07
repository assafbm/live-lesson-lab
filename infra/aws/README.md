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
- Cognito open registration with email verification and password sign-in.
- A separate retained DynamoDB table for lesson ownership and admitted participants.

WebRTC audio and video remain in the browsers. The signaling handler only
routes offers, answers, ICE candidates, and room state. TURN is not configured
in this stack; some restrictive networks may still need a separately reviewed
TURN relay.

## Learning the pieces

- API Gateway owns the long-lived browser WebSocket connections.
- Lambda runs briefly when a browser connects, disconnects, or sends a message.
- DynamoDB replaces the Node server's in-memory room map. It stores only room
  routing, membership and verified socket identity in the temporary table and
  expires idle rows using TTL. The separate lesson table retains ownership and
  admission records; it contains no media, passwords or tokens.
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
$env:VITE_AUTH_AUTHORITY = "<AuthAuthority stack output>"
$env:VITE_AUTH_CLIENT_ID = "<AuthClientId stack output>"
$env:VITE_AUTH_DOMAIN = "<AuthDomain stack output>"
npm run build --workspace @live-lesson-lab/web
aws s3 sync apps/web/dist "s3://<WebAppBucketName stack output>" --exclude "index.html" --cache-control "public,max-age=31536000,immutable"
aws s3 cp apps/web/dist/index.html "s3://<WebAppBucketName stack output>/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "<CloudFrontDistributionId stack output>" --paths "/*"
```

The placeholders must be replaced with the outputs from the deployed stack.
Do not commit the generated endpoint into source control; it is environment
configuration, not a credential. The endpoint is public by design, so the
server still needs room admission controls before unrelated users are invited.

## Automatic web deployments from GitHub

**Current status:** not activated. AWS Organizations policy denied OIDC provider
creation; the previous attempt rolled back. Default CDK synthesis/deployment
excludes federation resources so normal application work is not blocked.
After the organization policy is resolved, review `npm run diff -- -c
enableGithubDeploy=true`, then deploy with that same context. Verify the exact
GitHub OIDC subject matches the role trust policy before enabling the workflow.
Set `ENABLE_WEB_DEPLOY=true` only after that setup succeeds.

The repository includes `.github/workflows/deploy-web.yml`. After its one-time
setup, each push to `main` builds the web app, uploads the static files, and
invalidates CloudFront. A manual run is also available from the GitHub Actions
tab. The workflow uses GitHub OIDC to request temporary AWS credentials; there
are no long-lived AWS access keys in GitHub.

With that context enabled, the CDK stack creates a GitHub identity provider and a deploy role restricted
to `assafbm/live-lesson-lab` on the `main` branch. That role can list and update
only this website bucket and request cache invalidations only for this site's
CloudFront distribution. It cannot read the bucket or change the signaling
API, Lambda, or DynamoDB table.

After deploying the stack once with CDK, open the repository's **Settings →
Secrets and variables → Actions → Variables** and add these repository
variables from the CloudFormation outputs:

| Variable | Stack output | Example or meaning |
| --- | --- | --- |
| `AWS_ROLE_ARN` | `GitHubActionsDeployRoleArn` | Temporary deployment role to assume |
| `WEBAPP_BUCKET` | `WebAppBucketName` | Private S3 bucket for the web build |
| `CLOUDFRONT_DISTRIBUTION_ID` | `CloudFrontDistributionId` | Distribution to invalidate after upload |
| `VITE_SIGNALING_URL` | `WebSocketUrl` | The deployed secure WebSocket URL |
| `VITE_AUTH_AUTHORITY` | `AuthAuthority` | Cognito issuer URL |
| `VITE_AUTH_CLIENT_ID` | `AuthClientId` | Public browser client ID |
| `VITE_AUTH_DOMAIN` | `AuthDomain` | Hosted sign-in origin |

These values identify public infrastructure and are not credentials, so they
belong in repository variables rather than GitHub secrets. Do not add an AWS
access key or secret key to the repository. The initial CDK deployment is still
a manual, reviewed step; after that, a successful push to `main` publishes the
new web version automatically.

## Cost and access boundaries

The AWS Free plan is time-limited and restricts which services can be used.
AWS resources can also have quotas and charges. Review the current plan, region,
CloudFormation changes, and service pricing before bootstrapping or deploying.
The stack now provisions authentication and durable ownership/admission records.
It does not provision TURN, recording or recording delivery. Invitation expiry
and teacher access controls are implemented; distributed abuse controls, a
retention/deletion workflow and real-device audio acceptance remain release gates
before opening this controlled pilot to unrelated students.

The previous EC2 experiment was removed from the active stack because it
required custom DNS and proposed Kinesis Video Streams for TURN. AWS lists
Kinesis Video Streams outside the Free Tier.
