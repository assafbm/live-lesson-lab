# Decision 0006: Deploy the web app from GitHub Actions with AWS OIDC

## Status

Accepted design; deployment blocked. AWS Organizations policy denied creation
of the OIDC provider and the attempted stack update rolled back. The current
website remains available, but GitHub publication is not active. The provider
is now opt-in with CDK context `enableGithubDeploy=true`; the workflow requires
repository variable `ENABLE_WEB_DEPLOY=true` after federation is working.

## Context

The web app is built with Vite and served as static files from a private S3
bucket through CloudFront. Publishing manually requires a local AWS session,
an S3 sync, and a CloudFront cache invalidation. Long-lived AWS keys stored in
GitHub would create unnecessary credential risk.

## Decision

Use a GitHub Actions workflow to build and publish on pushes to `main`, with
OIDC federation to obtain temporary AWS credentials. Restrict the AWS role to
the `assafbm/live-lesson-lab` repository's `main` branch. Give it only the
permissions needed to list and update the web bucket and invalidate this site's
CloudFront distribution.

The first deployment of the updated CDK stack remains a reviewed, manual AWS
operation. It creates the OIDC provider and deploy role. The workflow then
reads non-secret deployment identifiers from GitHub repository variables.

## Consequences

- No AWS access keys need to be stored in GitHub.
- A successful push to `main` can publish the web build without manual uploads.
- API, Lambda, and DynamoDB resources are outside the deploy role's permissions.
- Infrastructure changes still require a separate CDK review and deployment.
- A GitHub Actions outage or a missing repository variable blocks publication,
  but does not affect the already deployed site.

## Alternatives considered

- Keep publishing by hand: simple, but easy to forget a build or cache refresh.
- Store a permanent AWS key in GitHub: convenient, but unnecessarily long-lived.
- Deploy all infrastructure from GitHub: rejected for now because infrastructure
  updates need a separate review while the pilot is still learning AWS.
