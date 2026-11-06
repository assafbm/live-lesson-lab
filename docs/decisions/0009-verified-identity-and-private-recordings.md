# Decision 0009: Open registration and private lesson identity

- Date: 2026-11-07
- Status: Implemented on `codex/verified-lesson-identity`; not deployed.
- Inherits screen sharing and room invitation controls.

## Product agreement

Anyone may register and create a lesson. There is no approved-teacher list.
Teacher and student are roles within a lesson, not permanent account categories.
Both participants verify their email. A recording is intended for private study
by the owner and eligible participants, not public discovery.

## Identity decisions and alternatives

1. Amazon Cognito owns passwords, signup verification and password recovery.
   The app uses its hosted sign-in page and a public OAuth client with authorization
   code + PKCE. There is no browser client secret. `oidc-client-ts` manages state,
   nonce, callback validation and refresh tokens instead of handwritten OAuth.
2. The owner confirmed verified email plus password for the first registration
   flow. Verify the address at registration, then sign in with email and password.
   Email OTP is an alternative, but Cognito requires Essentials or higher and
   SES configuration for that flow. The current pilot has no owned email domain.
   Classic hosted UI on Lite and Cognito's default verification email allow a
   smaller first rollout. Default email quotas make this a pilot, not a bulk
   registration service. Review costs and SES before broader availability.
3. Tokens live in tab session storage. This limits persistence, but does not make
   tokens immune to XSS. The restrictive CSP and dependency review still matter.
   We send the ID token in a WSS authentication message, never the URL. It is a
   narrow identity handshake, not authorization for arbitrary AWS resources.
   The server verifies signature, issuer, audience, token use, expiry and verified
   email using `aws-jwt-verify`. Decoded claims alone are never trusted.
4. Identity rows contain only stable Cognito subject, verified email and expiry.
   Tokens/passwords are not saved in DynamoDB or logged. Every room action checks
   unexpired identity. A socket cannot change accounts while retaining membership.
   Refresh repeats authentication, then refreshes room routing after acknowledgement.
   Logout revokes the refresh token best-effort and removes local credentials.
   Already-issued JWTs remain valid until expiration; immediate global revocation
   would require a separate server session/revocation mechanism.
5. The stable subject owns the room. An email address is contact information, not
   a database primary identity. Browser-supplied email or URL roles cannot grant
   ownership. This first version requires distinct accounts for teacher/student.
6. Production without identity settings fails closed. Anonymous local development
   is permitted only when all identity settings are absent; its signaling server
   binds loopback. Partial configuration does not enable anonymous fallback.

## Storage and its exact meaning

`RoomState` remains temporary routing and authentication state, with explicit
expiry checks plus asynchronous TTL cleanup. `LessonRecords` is separate durable
storage: one metadata row and participant rows keyed by lesson and subject.
Creation and admission write routing and durable records in the same transaction.
A failed join therefore cannot manufacture recording eligibility.

Admission means the server accepted the user into the room. It is not proof of
media reception, attention, recording consent or presence throughout a recording.
Rejoining updates the participant's latest admission timestamp. Teacher creation
records ownership before the teacher enters the meeting. Clean teacher closure
marks metadata closed transactionally; missed disconnects may leave stale open
metadata, which must never itself authorize a new join or prove live presence.

The durable table and user pool are retained on stack removal; the pool also has
deletion protection. The table has point-in-time recovery. There is no public
table access or browser AWS credential. Personal-data deletion and retention UI
are not implemented yet and must precede broad production use.

## Required recording composition (next increment)

The recording is a composed student study view:

```text
+----------------------------------+-------------------+
|                                  | Teacher face      |
| Teacher document or shared screen+-------------------+
|                                  | Student face      |
+----------------------------------+-------------------+
              Both voices in the audio mix
```

- Main content follows the teacher's document/screen switch, including returning
  to the document camera when display sharing stops.
- Teacher face is always upper right; student face is below, regardless of which
  browser owns the recorder or the live UI's local-face ordering.
- Sender rotation/mirroring is already in transmitted pixels. A student-side
  compositor should also apply the student's viewing rotation/zoom when the
  intention is to preserve exactly their study view.
- Use a controlled canvas composition plus a Web Audio mix and MediaRecorder.
  Capturing the entire desktop would expose unrelated windows and controls and
  require another screen picker. A canvas also gives consistent export dimensions
  independent of browser window size.
- Missing cameras use labelled placeholders. Muted audio stays muted. Do not
  route mixed audio to speakers or capture the same audio track twice.
- Recording starts only after explicit consent from both participants and a
  persistent recording indicator. Define behavior for departures, refreshes,
  background throttling, device loss and upload failure before release.
- Store files privately in S3. Email should contain an application link requiring
  sign-in and a server authorization check. A forwarded email must not grant access.
  Any short-lived object download URL is a bearer capability during its lifetime.
- Snapshot eligible consenting participants per recording. Do not grant an entire
  historical lesson recording automatically to every person who later joins.

This branch does **not** implement a recorder, S3 recording upload, playback API,
recording email, consent collection or recording retention. Participation records
are a foundation, not a complete recording authorization system.

## Release and verification

Protocol 7 requires a coordinated frontend/backend release and fresh rooms.
Review `cdk diff` before provisioning. Set the exact existing HTTPS origin in
`infra/aws/cdk.json`; wildcard callback URLs are intentionally unsupported.
Deploy infrastructure, then build the web app with all three Auth outputs and
the WSS endpoint. The workflow requires these values before publishing. Its
existing OIDC activation gate remains unchanged.

Local type/build checks, CDK synthesis, signed-JWT tests, mocked AWS transaction
tests and browser media regressions cover implementation boundaries. They do not
prove Cognito email delivery, real hosted login, AWS transactions or human audio
quality. Before release use two verified accounts to test signup, invitation
return after login, both directions of media, refresh, logout and denial of
unauthorized room actions. Existing live smoke scripts need identity-aware
accounts before they can exercise this protocol.

## Sources

- [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html)
- [Cognito email and OTP requirements](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-email.html)
- [JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [OIDC browser library](https://authts.github.io/oidc-client-ts/)
