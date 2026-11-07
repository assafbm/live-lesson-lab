# Guest access and lesson controls release — 2026-11-07

## Published

- Application commit: `5ad7c15` on `codex/verified-lesson-identity`.
- Website: https://d14zq4wr2313jx.cloudfront.net/?role=teacher
- AWS account: `072270723188`; region: `eu-north-1`.
- Stack: `LiveLessonLabServerlessStack`; final status: `UPDATE_COMPLETE`.
- Protocol: 8, deployed to both frontend and signaling Lambda.
- JavaScript: `index-DYhaGXn6.js`; CSS: `index-MDHlf9wh.css`.
- Distribution: `E30XBF427GBHVQ`.
- Invalidation: `I7B9V946KCM8IW9Q0RV6ZQ6UZ`; final status: `Completed`.

The owner requested AWS publication and renewed the CLI session. Account identity
was checked before deployment. CDK diff showed only the signaling Lambda code
update; no new resources or IAM changes were required for this increment.
Cognito and lesson records had already been provisioned during the identity
release. The previous release's unfinished invalidation is superseded by this
completed `/*` invalidation.

The website was rebuilt using the actual stack outputs, uploaded with hashed
assets first and `index.html` last, and served with the existing security headers.
Old assets were preserved. No GitHub-to-AWS automatic deployment was enabled;
this release used the owner's temporary CLI session.

## Verified

- The existing 33-test suite passed before release, including guest admission
  boundaries, names, accessible toolbar controls and synthetic two-way media.
- Type checks, application production build and infrastructure compilation passed.
- Public HTTPS returned the expected release asset and CSP headers.
- Teacher sign-in navigated to the real Cognito hosted login page.
- An unauthenticated student invitation opened the lobby without a login gate.
- Clicking Join on an invalid invitation produced the live AWS invalid-room error.
- Live signaling reported protocol 8 and rejected unauthenticated room creation.
- The public browser check captured no JavaScript runtime errors.
- CloudFormation and CloudFront both reported successful completion.

The public check did not sign in to an account, send verification emails or create
a real lesson. Therefore a successful authenticated teacher + guest student media
session on AWS remains a manual acceptance check. Local tests use synthetic media
and cannot establish natural voice quality or restrictive-network connectivity.

## Try the release

1. Reload both browsers and create a fresh lesson link.
2. Sign in as teacher, choose cameras and join the lesson.
3. Open the student link in a separate browser/private window. No account is needed.
   A signed-in student can also choose Continue as guest in the lobby.
4. Set names in the lobby or Settings. Video settings and Share screen are now
   separate toolbar actions. Hover or keyboard-focus an icon for its tooltip.
5. Test voice on separate devices with headphones. If it remains mechanical,
   export Connection diagnostics from Settings on both sides for the same interval.

No additional audio-processing fix was introduced by this release. The reported
audible issue is still open; publication alone is not evidence that it is solved.
