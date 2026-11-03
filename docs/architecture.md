# Architecture — Live Lesson Lab

## Purpose and scope

The MVP supports one teacher and one student. The teacher can select a source for each of two video roles: `face` and `document`. The student receives those views and can optionally send one camera view back to the teacher. Both participants can optionally send microphone audio. Each sender can rotate or mirror outgoing video before transmission. The receiver can also rotate, mirror, and zoom its own display independently.

The initial scope excludes a database, an authentication service, an SFU, recording, and AI. Rooms and connections will be managed in memory by the signaling server.

## Components

- `apps/web`: React, TypeScript, and Vite user interface. It handles pre-join camera setup, lesson creation/joining, optional two-way microphone audio, the connected meeting room, and WebRTC setup.
- `services/signaling`: Node.js, TypeScript, and WebSocket. It manages one teacher and one student per in-memory room and relays validated setup messages; it does not process or relay media.
- `packages/shared`: shared TypeScript contracts for protocol messages and media roles.

## Planned connection flow

1. Both browsers open a WebSocket connection to the signaling server.
2. The teacher creates a room and shares its link. Each participant presses **Login** independently to enter the meeting room; the student joins with the room identifier.
3. The server waits until both roles have entered, then relays `offer`, `answer`, and ICE candidates between the browsers.
4. The browsers establish an `RTCPeerConnection` with one audio and three video transceivers. Two video sections carry teacher views to the student; one carries the student's camera back to the teacher. Media attempts to travel directly between browsers with the help of STUN; TURN may be needed when a direct route is unavailable.
5. The teacher sends the face/document-to-MID mapping over signaling. If one participant exits the meeting, the server notifies the peer and keeps the remaining participant in the room while they wait for re-entry.

The current implementation creates a room in server memory, shares a join URL, and tracks whether each role has entered the meeting. It starts WebRTC only after both roles enter. The teacher is the offerer. Both participants can send microphone audio. The teacher can send up to two video sources; the student maps incoming video by MID to the two logical roles and can send one camera track back to the teacher. `exit-room` releases only the caller's peer connection and keeps their signaling-room membership so they can re-enter.

## Media sources and role mapping

Physical device IDs stay in the local browser. `CameraSourceManager` avoids capturing the same `deviceId` more than once, even when both preview components and the WebRTC sender lease the source. If `face` and `document` use the same camera, both roles map to the same negotiated MID and one WebRTC sender. The student renders the same received stream for both views. Different cameras occupy separate senders and separate MIDs.

Three video transceivers are negotiated up front, regardless of how many cameras are selected. The first two are teacher-to-student role slots; the third is the student's single outgoing camera slot. Camera selection changes call `RTCRtpSender.replaceTrack` on those stable senders, then the teacher sends a small role-to-MID mapping for its two views. This supports zero, one, or two teacher sources and camera changes without renegotiation. The student camera has a fixed third slot, so no device ID or extra role mapping is needed.

Before an outgoing camera track is attached to a WebRTC sender, `OutgoingVideoTransform` draws its frames into a canvas and exposes the canvas with `captureStream`. Rotation and mirroring therefore change the pixels the peer receives. The local preview can use this same processed stream, making it easy to confirm what is being sent. A processor is created per selected physical device, so a shared face/document camera is captured and transformed once and mapped to one MID. Its sender transform controls are linked because one track cannot carry two different versions of the same camera at once. The student's one outgoing track uses the same pipeline.

## Lesson media

Each participant adds one `sendrecv` audio transceiver to the peer connection. It remains negotiated while both microphones are off, so the connection can establish without requesting microphone permission. When a participant unmutes, the browser captures that microphone and attaches its track with `replaceTrack`; muting detaches and stops the local microphone track. The incoming audio track is played in the meeting room. This lets either participant speak without a new SDP exchange.

The teacher creates the offer with four media sections in a fixed order: bidirectional audio, teacher face video, teacher document video, and student video. The student does not pre-create transceivers. After applying the teacher's offer, it binds the browser-created transceivers by MID, keeps the two teacher video sections receive-only, sets audio to send-receive, and sets the student video section send-only before creating the answer. This avoids orphan transceivers with no MID and inactive negotiated sections. The student's single camera uses only the final video section; the teacher receives no second student camera track.

The room and signaling state live only in server memory. A server restart ends every room. STUN is configured for direct peer discovery; a TURN server is not configured yet, so some real networks may fail to connect.

## Public demo and data storage

Teacher pages use an explicit `?role=teacher` URL; student invitations use `?role=student&room=...`. The older `?room=...` form remains accepted for compatibility. The Render Blueprint builds the Vite app and Node.js signaling server into one web service: the Node process serves the built static files, `/health`, and the `/signal` WebSocket endpoint on one HTTPS origin. This avoids cross-origin configuration for the first public demo. If the web app and signaling server are split later, `VITE_SIGNALING_URL` supplies the full secure WebSocket endpoint. Hosted signaling listens on the platform-provided `PORT`, with `SIGNALING_PORT` as the local-development fallback.

The live room is intentionally temporary: the signaling server keeps its participants and session state in memory, WebRTC sends audio/video between browsers, and the database is currently unnecessary. Camera and microphone tracks are never written to a database. A database becomes useful if the product later needs persistent accounts, lesson schedules, saved preferences, or lesson history. It would store those records, not live media. Public deployment still needs a WebSocket host and a TURN plan for networks where direct peer-to-peer media is blocked.

## Viewing layout

After either participant logs in, they see a full-viewport room with no page scrolling, even while the other role is still in its lobby. The teacher's document camera (or a waiting placeholder) fills the central stage. A right-side rail stacks the local face camera above the other participant's face camera. A connection status indicates when the peer is still joining. Sender controls change outgoing pixels before transmission; receiver controls change only that receiver's local display. The student can also zoom the teacher's document view. If both teacher roles use one physical camera, they share one processed track and one linked sender transform. A bottom toolbar contains microphone and disconnect controls.

## Detailed decisions

See [Decision 0001](decisions/0001-monorepo-and-signaling.md) and [Decision 0002](decisions/0002-connected-meeting-room.md).
