# Private recording deployment — 2026-11-07

## Published

- Application commits: `28ed8b7` and `b0949cb` on `codex/verified-lesson-identity`, pushed to GitHub.
- Teacher: https://d14zq4wr2313jx.cloudfront.net/?role=teacher
- Stack: `LiveLessonLabServerlessStack`, account `072270723188`, region `eu-north-1`.
- CloudFormation final status: `UPDATE_COMPLETE`.
- Bucket: `live-lesson-lab-recordings-072270723188-eu-north-1`.
- Recording API: `https://ccocceeddvysig4z2qgol2tj3u0tutkj.lambda-url.eu-north-1.on.aws/`.
- Assets: `index-BWSQCKvz.js`, `index-Dc_5yglo.css`.
- CloudFront invalidation: `I613W753E8AINDJX3QATGJ4RB5`, `Completed`.

The automatic approval service initially blocked an AWS review command because
its usage limit was reached. The user subsequently requested continuation and
publication without another confirmation. The retry succeeded; no approval
checks were bypassed. The reviewed change added the recording bucket, API,
scoped database/S3 permissions and matching CSP sources. Public Lambda invocation
is restricted to the function URL and application actions require verified JWTs.

## Verification

- 46 automated tests passed: existing lesson regressions, recording authorization,
  consent, current participant snapshots, part bounds, download restrictions,
  completion, heartbeat, real browser encoding/decoding and consent/start/stop UI.
- Workspace type checks, production build and infrastructure compilation passed.
- Real S3 synthetic check passed: multipart creation, content-length-bound signed
  part upload, CORS preflight, completion, signed download and byte equality.
- The same completed object was denied to anonymous GET (403). Bucket public
  access blocking and 30-day object / one-day incomplete-upload lifecycle verified.
- Synthetic upload data was deleted in cleanup. No real lesson media was used.
- Public website served the expected release, guest join remained available,
  student recording sign-in redirected to Cognito, and browser requests to the
  recording API were allowed by CSP/CORS but rejected without identity (401).
- No browser page errors occurred in the public smoke check.

The cloud storage check used the deployment identity; it is not a complete
signed-user API workflow. Backend authorization is covered by adapter tests.
A real two-account recording still needs manual acceptance, including long lesson
upload, actual microphone quality, and playback on the participants' devices.
No test accounts or email notifications were created.

## Trying it

1. Both participants sign in with distinct verified accounts before joining.
   Student invitations offer **Sign in for recordings**; guest attendance stays optional.
2. In the lesson, open the circular **Record lesson** toolbar button and request recording.
3. Each participant clicks **I consent to this recording**.
4. The student clicks **Start recording and upload** and keeps their tab visible.
5. Either participant stops recording. Keep the student tab open until saving finishes.
6. After the lesson, load **My recordings** and download the WebM. The owner may delete it.

Recordings are private to the consenting pair and retained for 30 days. Download
URLs expire after five minutes. The student view includes both voices; it does not
repair poor incoming audio. Email delivery and crash-resume are not implemented.

See [ADR 0013](decisions/0013-private-student-view-recordings.md) for architecture,
tradeoffs, limits and security decisions.
