# Development decisions and alternatives

Updated: 2026-11-06. Read with [the review report](review-2026-11-06.md).

Feature-branch update, 2026-11-07: [Decision 0008](decisions/0008-room-access-controls.md)
records server-enforced invitation expiry, lock/unlock, renewal and terminal
room closure. It is implemented on `codex/room-access`, not the deployed pilot.

This report consolidates the Hebrew project specification, the owner's later
requirements, the existing architecture decisions, the learning log, and the
current implementation. Later explicit product decisions supersede the original
specification where they differ. It is a reconstruction of the documented
development history, not a claim that every undocumented conversation was recorded.
The reasons below explain the engineering tradeoffs; historical deployment
proposals are clearly distinguished from running components.

## 1. Product and repository

| Decision | Reason | Alternative and tradeoff | Status |
| --- | --- | --- | --- |
| One teacher and one student initially | Keep media routing and learning scope understandable | Multiple students require new room admission, UI, bandwidth and negotiation design | Implemented |
| React, TypeScript and Vite | Typed UI state, quick local development and static production output | A full server-rendered framework adds server concerns without a current need | Implemented |
| One npm-workspace monorepo | Client, servers and protocol can change together | Separate repositories need coordinated protocol releases | Implemented; ADR 0001 |
| Shared message contract plus runtime validation | TypeScript cannot validate messages arriving from another browser | Trusting TypeScript alone permits malformed network input | Implemented; validation tightened in this review |
| English code, comments and documentation | Consistent terminology and readable mixed-language discussions | Bilingual code and sentences were difficult for the owner to read | Owner decision |
| Teaching comments and decision records | Explain ownership, asynchronous lifecycle and reasons for choices | Comments that merely restate syntax add noise | Implemented; consolidated here |
| Meaningful logical names; generated AWS physical names | Explain resource purpose without replacing live resources just to rename them | Fixed bucket names risk global collisions; renaming stateful resources can recreate them | Current convention |

## 2. Connections, tracks and camera ownership

The signaling connection carries JSON setup/control messages. WebRTC transports
media. A track is the audio or video source. A transceiver owns one negotiated
audio or video section, with a sender and receiver; it is not a network port.

| Negotiated section | Teacher direction | Student direction | Purpose |
| --- | --- | --- | --- |
| MID 0 | sendrecv | sendrecv | One audio section, with an independent microphone track in each direction |
| MID 1 | sendonly | recvonly | First teacher video source |
| MID 2 | sendonly | recvonly | Second teacher video source, if needed |
| MID 3 | recvonly | sendonly | Student camera |

These are four sections per peer connection, not five. Two-way audio does not
require two audio sections. Reserved sections can exist without a sender track.
Logical face/document roles map to the teacher's video MIDs; the slot number
does not permanently identify a particular physical camera.

| Decision | Reason | Alternative and tradeoff |
| --- | --- | --- |
| Teacher creates offers | A single offerer avoids negotiation collisions in the initial two-person model | Perfect negotiation is more general but adds state and collision handling |
| Student binds to sections created by the remote offer | Fixes the observed duplicate-transceiver bug | Pre-creating four student sections left the camera on an unnegotiated section with null MID; the negotiated return section became inactive |
| Reserve sections before cameras are enabled | Adding a camera or microphone uses `replaceTrack` | Adding new sections every time needs renegotiation; large format changes can still require renegotiation later |
| Fixed MID mapping in protocol v5 | Both endpoints are this app and use a fixed offer layout | Dynamic semantic section mapping is needed before interoperating with other apps or changing the topology |
| Acquire once per physical device | Preview and sender share manager-owned capture leases | Calling getUserMedia for each role opens redundant captures and complicates cleanup |
| Transmit once when roles share a camera | Both roles reference one MID and one output track | Sending the same track through two senders duplicates upload and encoding |
| Camera IDs stay local | Device selection is a local hardware concern | Sharing device IDs exposes unnecessary device information and does not help a remote browser |
| Release captures on exit and discard late requests | Permissions can resolve after the user disconnects | Keeping obsolete captures wastes resources and leaves camera/mic indicators active |

The earlier one-way-media bug was not an ICE routing mistake. ICE connected;
the student's sender was attached to the wrong transceiver. Tests now verify
that the teacher receives the student's video and audio and that a camera can
be enabled after joining without creating extra sections.

## 3. Video quality and transformations

| Decision | Reason | Alternative and tradeoff |
| --- | --- | --- |
| Request ideal 1920×1080, ideal 24 fps, maximum 30 fps | Start with readable document detail and bounded capture work | Exact 1080p rejects weaker cameras; unlimited resolution/frame rate can compete with audio for CPU and bandwidth |
| Let WebRTC adapt actual transmitted quality | Available hardware, CPU and network vary | Forcing a high bitrate cannot guarantee quality and can increase congestion |
| Send the original camera track for neutral transforms | Avoid unnecessary canvas work and preserve source detail | Always using canvas copied every stream even when no pixels changed |
| Apply outgoing rotation/mirror to pixels using canvas | The peer receives the orientation chosen by the sender | CSS-only rotation affects only the local preview and contradicted the owner's requirement |
| Process on new video frames, output capped at 30 fps | Avoid repeated work on each display refresh | Main-thread canvas still has performance/background-tab limits; a worker/WebCodecs pipeline is a later option |
| Shared camera has shared outgoing transform | Both logical roles use one real transmitted source | Independent outgoing transforms need two outputs/encoders and violate the current deduplication goal |
| Receiver may rotate/mirror/zoom locally | Receiving student can adapt the document to their own viewing position | Sending view preferences back changes another participant's experience unnecessarily |
| Document uses detail hint; face uses motion hint | Communicate intended encoder priority | These are browser hints, not guarantees of resolution, codec or bitrate |
| Fit using actual rotated dimensions | Keep the whole document visible at different aspect ratios | A fixed scaling factor clips some orientations and wastes space in others |

No claim of maximum possible quality is justified from fake-camera tests.
Real handwriting, low light, slower hardware, hidden tabs and cross-network
calls remain acceptance scenarios.

## 4. Audio quality and evidence

| Decision | Reason | Alternative and tradeoff |
| --- | --- | --- |
| Separate microphone capture from camera capture | Camera selection must not interrupt voice | A combined camera/microphone capture couples unrelated device changes |
| One dedicated remote audio element; video elements muted | Play each incoming voice exactly once | Playing audio through several face/document tiles can cause doubling or echo |
| Start muted; signal microphone state explicitly | Respect user control and show accurate peer status | Track mute events alone do not reliably represent `replaceTrack(null)` |
| Ideal mono 48 kHz; speech hint | Speech does not need stereo capture; let browser negotiate supported settings | Hard exact constraints can reject devices, and changing sample rate alone does not cure robotic sound |
| Default echo cancellation, suppression and gain control on | Practical speech defaults for speakers and ordinary rooms | Processing can sound unnatural on some devices; disabling echo cancellation with speakers can create feedback |
| Expose processing and input-device choices | Make hardware and processing issues diagnosable | A single forced preset cannot suit every headset and microphone |
| Check effective settings after changes | Chrome tests showed applyConstraints could resolve while settings stayed unchanged | Assuming a fulfilled promise means effective settings changed hid failed adjustments |
| Stop old same-device capture before fallback recapture | Overlapping Chrome captures retained the old processing configuration during tests | This causes a brief microphone pause; another tab using the same mic can still prevent the change, so show a notice |
| Serialize capture/sender changes; use generation guards | Prevent stale requests from attaching after mute/disconnect | Uncoordinated asynchronous capture can leak tracks or attach the wrong request |
| Export bounded, sanitized interval diagnostics | Compare sender and receiver rates, concealment ratio, delay, level and codec | Cumulative counters and zero packet loss alone do not establish healthy audio |

**Audio status:** measurable failure paths are fixed, but the reported mechanical
sound is not proven resolved. Synthetic audio proves transport and lifecycle,
not natural voice quality. A two-device headset listening test and paired
diagnostic downloads are still necessary. Do not treat silence suppression,
missing stats, or a cumulative concealed-sample count as a conclusive diagnosis.

## 5. Room lifecycle and interface

| Decision | Reason | Alternative and tradeoff | Status |
| --- | --- | --- | --- |
| Explicit teacher/student URLs | Make intended entry role clear | A URL role is not proof of identity | Implemented |
| Separate pre-join and meeting views | Configure devices before entering a focused lesson | Showing remote student preview in teacher setup was confusing and removed | Implemented |
| Independent Join lesson and Disconnect actions | Either participant can wait or re-enter without closing the other's screen | Meeting presence is separate from WebSocket membership | Implemented |
| Teacher document on main stage, local and remote faces in rail | Prioritize shared teaching material and consistent layout | Floating video tiles can cover handwriting | Implemented; ADR 0002 |
| Fixed viewport, responsive controls, scrollable settings | Keep lesson controls reachable without page scrolling | Whole-page scrolling moves controls out of view | Tested at desktop, portrait and short landscape sizes |
| Shared microphone settings component | Keep wording and behavior consistent across roles | Duplicated markup drifts | Added in review |
| Keyboard focus, Escape dismissal, playback recovery | Make settings and audio failures recoverable | Silent autoplay rejection leaves a seemingly connected but inaudible lesson | Improved in review |
| Teacher socket loss closes the current room | Current room ownership is tied to that connection | Recoverable teacher ownership needs identity/session tokens and reconnection design | Current limitation, distinct from the Disconnect button |

## 6. Hosting history and actual AWS boundaries

1. **Local Node WebSocket server:** room state in memory; still used for local development and browser regression tests.
2. **Render proposal (ADR 0003):** one service hosting web and signaling. Superseded when the owner chose AWS learning. It is not the current production host.
3. **EC2/Caddy/Kinesis proposal (ADR 0004):** explored a VM, custom DNS and managed TURN. Never deployed; superseded because the actual pilot had no domain and account/service constraints.
4. **Current AWS pilot (ADR 0005):** private S3 static assets, CloudFront HTTPS, API Gateway WSS, Lambda signaling, DynamoDB temporary routing state. This stack was deployed before this review.

| Choice | Why | Alternative and tradeoff |
| --- | --- | --- |
| AWS rather than Cloudflare/Render | Owner explicitly wanted AWS practice | Other platforms may reduce setup work; this is a learning/product choice, not a claim AWS is universally superior |
| CloudFront generated hostname | HTTPS without purchasing a domain | A custom domain improves branding and can be added later |
| DynamoDB for temporary routing | Stateless Lambda invocations need shared membership state | The original no-database choice still fits local Node; schedules, users and recordings are not stored here |
| Strong reads, conditional writes and application expiry checks | TTL cleanup is delayed and concurrent messages can race | Eventual reads and TTL alone are insufficient admission checks |
| CDK TypeScript | Reviewable, repeatable infrastructure in the project language | Console-only changes are difficult to reproduce and audit |
| STUN-only for now | Existing pilot connects where direct networking permits | TURN is needed for restrictive networks; it has credentials, abuse controls and cost implications |
| No SFU | Current room is two people | More participants/central recording can justify revisiting the media topology |
| No media storage | Live teaching does not require recording | Recording requires consent, access control, retention and storage design |

S3 contains built HTML/CSS/JavaScript, not live video. CloudFront is the AWS CDN;
it is not Cloudflare. API Gateway/Lambda carry signaling, not lesson RTP media.
The current DynamoDB table is ephemeral room state, not a student database.

## 7. Security and delivery

| Decision | Reason | Alternative and tradeoff | Status |
| --- | --- | --- | --- |
| Private S3 with CloudFront origin access and HTTPS | Serve the app without a publicly readable bucket | Public website buckets expose objects directly | Existing stack |
| Validate size, roles, room ownership and candidate fields | Reject malformed and cross-room messages at trust boundaries | Client validation is bypassable | Strengthened locally in this review |
| 32 KiB signaling envelope | Match API Gateway's frame limit | Larger SDP needs explicit fragmentation/reassembly design | Implemented locally |
| Restrict connection-management IAM to this API | Reduce authority available to Lambda | Account-wide API wildcard grants unnecessary access | Prepared locally |
| CSP, no-referrer, no external font request, anti-framing headers | Reduce script/origin exposure and avoid leaking invite URLs via referrers | Broader origins simplify integration but widen the surface | Header changes require deployment |
| Local per-socket message budget | Bound a single development-server connection's work | This is not distributed AWS abuse protection | Implemented locally |
| GitHub OIDC temporary credentials | Avoid permanent AWS keys in repository secrets | Manual CLI publishing remains possible | Planned but blocked by organization policy |
| OIDC resources opt-in and workflow disabled until configured | Prevent unrelated application updates from failing on denied IAM creation | Repeatedly retrying a policy denial does not resolve it | Prepared locally |
| Pin workflow actions and disable persisted checkout credentials | Reduce mutable dependencies and unnecessary credential persistence | Pinned actions need deliberate updates | Prepared locally |
| Upload hashed assets first, index last; retain old hashes | Existing lesson tabs can keep loading their release | Immediate `sync --delete` removes files referenced by older pages | Prepared locally |

The attempted OIDC deployment rolled back because an AWS Organizations service
control policy denied provider creation. This is an account-policy issue, not a
request for access keys. Enable federation only after it is allowed, inspect the
actual GitHub token subject format, and retain an exact repository/branch trust
condition. Do not broaden the trust policy just to make a workflow succeed.

The app does **not** yet have authenticated teachers, revocable student invites,
full admission control, robust AWS abuse throttling, or dependable reconnection.
A hard-to-guess room link is a bearer capability, not user authentication. This
review does not certify the pilot as ready for unrelated teachers or sensitive
student information. See the prioritized release gates in the review report.

## 8. Testing and deferred product scope

Automated browser tests exercise fake media in Chrome, real local WebSockets,
role/room isolation, capture cleanup, bidirectional transport, transforms,
autoplay recovery and responsive layout. AWS handler tests mock SDK calls;
CDK synthesis checks construction of infrastructure, not a deployed AWS end-to-end
session. These layers intentionally have different evidence limits.

Deferred requirements remain recorded: scheduled rooms and time-window admission,
recordings in S3, a second student, screen sharing as the document source,
authenticated room ownership, expiring invitations, TURN, and automatic recovery.
Recording needs consent/retention and access controls before storage; scheduling
needs durable lesson metadata and server-enforced times; a second student needs
a media-topology review; screen share needs user-gesture capture and track-ended
handling. Stabilize the ordinary two-person lesson first, as the owner requested.

The follow-up [screen sharing and recording decision](decisions/0007-screen-sharing-and-recording.md)
sets the sequence: release stabilization, validate audio, add screen sharing as a
document-source replacement, then design recording with consent/access/retention.

## References

- Existing ADRs: [0001](decisions/0001-monorepo-and-signaling.md), [decision directory](decisions/).
- [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/): interval counters and concealment semantics.
- [AWS WebSocket quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-execution-service-websocket-limits-table.html): frame and connection limits.
- [Learning log](learning-log.md): incremental implementation explanations.
