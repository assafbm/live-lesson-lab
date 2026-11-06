# Stabilization release — 2026-11-06

## Published

- Website: https://d14zq4wr2313jx.cloudfront.net/
- AWS account: 072270723188; region: eu-north-1.
- Stack: LiveLessonLabServerlessStack; final status: UPDATE_COMPLETE.
- Distribution: E30XBF427GBHVQ.
- Cache invalidation: IA28G08STPBPUBP3UOYP43YFS0; final status: Completed.
- Web assets: `index-D6IRpfgy.js` and `index-BmXDOqFu.css`.

The owner authorized continuing after AWS CLI login. Account identity was checked
against the existing pilot before changes. CDK diff showed an updated signaling
Lambda, narrowed API connection-management permission, and a CloudFront response
headers policy. No bucket/table replacement, new recording storage, or new media
service was proposed. The previously denied OIDC provider was explicitly disabled.

CDK deployed successfully. The web app was built with the existing WSS endpoint,
hashed assets were uploaded first, and index.html was uploaded last with no-cache.
Old hashed assets were retained so already-open pages do not lose their release.
CloudFront invalidation completed. Refresh both participants before testing the
new version; create a fresh lesson link to avoid mixing old and new browser code.

## Verification

`node scripts/check-deployed-lesson.mjs` passed against the published site:

- HTTPS response and expected CSP/no-referrer/nosniff headers.
- Real API Gateway/Lambda/DynamoDB room creation and joining.
- Teacher shared-camera video received by the student.
- Student video received by the teacher.
- Synthetic microphone packets received in both directions.
- New connection diagnostics visible.
- Student disconnect/re-entry while teacher stays in the room.
- No captured browser runtime or CSP errors.

This complements the preceding 11-test local regression suite and nine repeated
browser scenario passes. The live check used two script-owned Chrome contexts on
one computer with synthetic devices. It does not establish natural voice quality,
cross-network connectivity, long-session recovery, or TURN behavior.

## Next acceptance step

Use separate devices and headphones. Refresh both browsers, create a new link,
and speak continuously for 30 seconds in each direction. If voice is still
mechanical, weak or intermittent, download Settings → Connection diagnostics on
both sides from the same interval. The fixes make effective microphone settings
and transport behavior diagnosable; the original audible issue is not declared
resolved until this listening test succeeds.

## Feature sequence and remaining limits

See [Decision 0007](decisions/0007-screen-sharing-and-recording.md). Screen sharing
is the next feature after audio acceptance; recording is deferred until consent,
authorization, retention and storage decisions are implemented. Neither feature
was silently added to this stabilization release.

The app remains a controlled pilot. Authentication, revocable invitations,
distributed abuse controls, TURN and robust reconnect remain open. The CDK
toolchain still has the two moderate minimatch-related audit findings recorded
in the review. GitHub automatic publishing remains disabled pending the account's
OIDC policy change; this release was published manually with the owner's CLI
session, without permanent AWS keys or disabled TLS verification.
