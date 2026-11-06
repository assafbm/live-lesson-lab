# Architecture — Live Lesson Lab

## Purpose and scope

The MVP supports one teacher and one student. The teacher can select a source for each of two video roles: `face` and `document`. The student receives those views and can optionally send one camera view back to the teacher. Both participants can optionally send microphone audio. Each sender can rotate or mirror outgoing video before transmission. The receiver can also rotate, mirror, and zoom its own display independently.

The local MVP excludes a database, an authentication service, an SFU, recording, and AI. The AWS deployment uses a small DynamoDB table only for temporary connection and room-routing state, with expiry. It does not store lesson media or lesson history.

## Components

- `apps/web`: React, TypeScript, and Vite user interface. It handles pre-join camera setup, lesson creation/joining, optional two-way microphone audio, the connected meeting room, and WebRTC setup.
- `services/signaling`: Node.js, TypeScript, and WebSocket for local development. It manages one teacher and one student per in-memory room and relays validated setup messages; it does not process or relay media.
- `services/aws-signaling`: AWS Lambda adapter for the same shared protocol. It stores temporary room membership in DynamoDB and uses API Gateway's connection management API to relay messages.
- `packages/shared`: shared TypeScript contracts for protocol messages and media roles.

## Connection flow

1. Both browsers open a WebSocket connection to the signaling server.
2. The teacher creates a room and shares its link. Each participant presses **Join lesson** independently to enter the meeting room; the student joins with the room identifier.
3. The server waits until both roles have entered, then relays `offer`, `answer`, and ICE candidates between the browsers.
4. The browsers establish an `RTCPeerConnection` with one audio and three video transceivers. Two video sections carry teacher views to the student; one carries the student's camera back to the teacher. Media attempts to travel directly between browsers with the help of STUN; TURN may be needed when a direct route is unavailable.
5. The teacher sends the face/document-to-MID mapping over signaling. If one participant exits the meeting, the server notifies the peer and keeps the remaining participant in the room while they wait for re-entry.

The current implementation creates a room in server memory, shares a join URL, and tracks whether each role has entered the meeting. It starts WebRTC only after both roles enter. The teacher is the offerer. Both participants can send microphone audio. The teacher can send up to two video sources; the student maps incoming video by MID to the two logical roles and can send one camera track back to the teacher. `exit-room` releases only the caller's peer connection and keeps their signaling-room membership so they can re-enter.

## Media sources and role mapping

Physical device IDs stay in the local browser. `CameraSourceManager` avoids capturing the same `deviceId` more than once, even when both preview components and the WebRTC sender lease the source. If `face` and `document` use the same camera, both roles map to the same negotiated MID and one WebRTC sender. The student renders the same received stream for both views. Different cameras occupy separate senders and separate MIDs.

Three video transceivers are negotiated up front, regardless of how many cameras are selected. The first two are teacher-to-student role slots; the third is the student's single outgoing camera slot. Camera selection changes call `RTCRtpSender.replaceTrack` on those stable senders, then the teacher sends a small role-to-MID mapping for its two views. This supports zero, one, or two teacher sources and camera changes without renegotiation. The student camera has a fixed third slot, so no device ID or extra role mapping is needed.

Neutral camera tracks go directly to WebRTC. When rotation or mirroring is requested, `OutgoingVideoTransform` draws frames into a canvas and exposes it with `captureStream`. These transforms therefore change the pixels the peer receives. The local preview uses the same outgoing stream. One processor per physical device means a shared face/document camera is captured and transformed once and mapped to one MID. Sender transform controls are linked. New video frames drive canvas work, capped at 30 fps; untransformed video avoids this extra processing. The student's camera uses the same pipeline.

## Lesson media

The teacher creates one `sendrecv` audio section; the student binds to the corresponding section from the offer. It remains negotiated while both microphones are off. Unmuting captures and attaches the microphone with `replaceTrack`; muting detaches and stops it. One dedicated audio element plays incoming sound, while all video elements are muted. Microphone changes are serialized, late capture results are stopped, and processing changes are checked against effective browser settings. If Chrome ignores an in-place change, the old capture is stopped before reopening. This can briefly interrupt sound during a settings change.

The teacher creates the offer with four media sections in a fixed order: bidirectional audio, teacher face video, teacher document video, and student video. The student does not pre-create transceivers. After applying the teacher's offer, it binds the browser-created transceivers by MID, keeps the two teacher video sections receive-only, sets audio to send-receive, and sets the student video section send-only before creating the answer. This avoids orphan transceivers with no MID and inactive negotiated sections. The student's single camera uses only the final video section; the teacher receives no second student camera track.

Locally, room and signaling state live only in server memory. A signaling-server restart ends every room. STUN is configured for direct peer discovery; a TURN server is not configured yet, so some real networks may fail to connect.

## Public demo and data storage

Teacher pages use an explicit `?role=teacher` URL; student invitations use `?role=student&room=...`. The older `?room=...` form remains accepted for compatibility. The current AWS direction for `Fresh Deploy` in `eu-north-1` serves the built Vite app from a private S3 bucket through CloudFront's generated HTTPS hostname. API Gateway provides a generated WSS hostname. API Gateway invokes Lambda for each signaling message; DynamoDB stores temporary room membership and connection IDs with TTL so one invocation can find and notify the other browser. WebRTC media remains peer-to-peer. Amazon Kinesis Video Streams is not included because AWS documents it as outside the Free Tier. TURN relay remains an open deployment decision. See [Decision 0005](decisions/0005-domain-free-aws-pilot.md). The earlier Render and EC2 plans remain historical drafts.

The live room is intentionally temporary: camera and microphone tracks never enter AWS storage. Locally, signaling keeps its state in memory. In the serverless deployment, DynamoDB holds ephemeral room membership and WebSocket connection IDs and removes them using TTL; this is needed because Lambda invocations do not share process memory. This is not a lesson-history database. Persistent profiles, schedules, preferences, or lesson history remain out of scope. A real-user pilot also needs teacher access control, expiring lesson invitations, rate limits, and a TURN solution before the service is opened broadly.

## Viewing layout

After either participant logs in, they see a full-viewport room with no page scrolling, even while the other role is still in its lobby. The teacher's document camera (or a waiting placeholder) fills the central stage. A right-side rail stacks the local face camera above the other participant's face camera. A connection status indicates when the peer is still joining. Sender controls change outgoing pixels before transmission; receiver controls change only that receiver's local display. The student can also zoom the teacher's document view. If both teacher roles use one physical camera, they share one processed track and one linked sender transform. A bottom toolbar contains microphone and disconnect controls.

## Detailed decisions

See the consolidated [development decisions and alternatives](development-decisions.md)
and [current review findings](review-2026-11-06.md). They distinguish deployed
behavior from local review changes and record remaining audio/security limits.

See [Decision 0001](decisions/0001-monorepo-and-signaling.md) and [Decision 0002](decisions/0002-connected-meeting-room.md).
