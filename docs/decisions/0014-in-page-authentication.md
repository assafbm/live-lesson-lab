# ADR 0014: In-page Cognito authentication

## Decision
Use a native modal, styled with the lesson interface, for email/password sign-in, registration, email verification and password recovery. AWS Amplify Auth connects to the existing Cognito pool and public client. This changes the frontend SDK, not our hosting platform.

Passwords have a minimum length of eight characters. Uppercase, lowercase, number and symbol requirements are disabled as requested. Email verification, throttling, token expiry and backend JWT verification remain enabled. Existing users and passwords remain valid.

## Alternatives
- Hosted Cognito redirect: less UI maintenance, but leaves the lesson page and cannot fully match its design. The user's antivirus blocked that hosted domain; no antivirus protections were disabled.
- Hosted UI in a browser popup: still a separate site and subject to popup blocking.
- Custom modal with Amplify Auth (selected): preserves invitation URLs and delegates SRP, refresh and revocation to AWS's SDK instead of implementing cryptography ourselves.
- Custom password database: unnecessary additional security responsibility.

## Sessions and security
Tokens use tab-scoped session storage, never invitation URLs. Passwords exist only in form state and SDK requests, and are cleared when switching steps or closing. Registration and password recovery go directly to Cognito over HTTPS. Backend JWT verification and private recording authorization are unchanged. Students can still join as guests.

Old OIDC sessions are not migrated: users sign in once again after this release. Their accounts are unchanged. The hosted domain remains provisioned but the app no longer navigates there.

## Verification
Browser flow tests simulate Cognito HTTP responses without registering real accounts. Type checks, regression tests, infrastructure diff and deployed policy inspection supplement them. Actual email delivery and an existing user's credentials require manual acceptance testing.

## References
- https://docs.amplify.aws/react/build-a-backend/auth/concepts/tokens-and-credentials/
- https://docs.amplify.aws/react/frontend/auth/sign-in/
- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_PasswordPolicyType.html
