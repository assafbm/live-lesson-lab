# Decision 0002: Connected meeting room and symmetric microphone audio

- Status: Accepted
- Date: 2026-11-03

## Context

The previous connected lesson view used different page layouts for the teacher and student. The student needed a central document view, face views for both participants, a way to control local viewing transforms, and controls that stay usable at different screen sizes. The teacher also needs to see the student's one outgoing camera. Both participants should be able to speak.

## Decision

- Keep a pre-join lobby for each role. The teacher chooses face and document cameras there; the student may choose one face camera or join with video off.
- Let each participant enter the meeting room independently. Show the full-viewport meeting surface immediately with a waiting/connecting status, then update it when WebRTC connects.
- Show the teacher's document role in the central stage. Stack each participant's local face preview above the remote face video in a side rail. On narrow screens, move that two-tile rail beneath the main stage.
- Keep camera selection and student viewing transforms in a small in-room view-settings panel, so enabling or changing a camera mid-call stays available.
- Treat the in-room disconnect button as a participant exit, not as “end the lesson.” Keep the room and the other participant's screen alive so either role can re-enter independently.
- Use one pre-negotiated `sendrecv` audio transceiver for both participants. Keep microphones off until the owner unmutes; attach or remove the microphone with `replaceTrack` without renegotiating.
- Keep the signaling server as a setup-message relay. Audio and video continue to use the peer connection.

## Consequences

- The teacher still sends at most two camera tracks and the student sends at most one. Repositioning a tile does not create another track or camera capture.
- Both participants can speak. WebRTC carries the audio, while a small signaling state message keeps the peer's microphone indicator synchronized even when the browser does not fire a remote track `mute` event for `replaceTrack(null)`.
- Camera selection remains dynamic because the existing sender sections are reserved during the initial offer/answer exchange.
- The connected screen uses viewport-sized grid rows and hidden overflow. This keeps controls and video visible without page scrolling, while the lobby may still scroll on a small device.
- Mobile has less room for the central document view because both face tiles remain visible in a compact row. A later product decision may add an explicit compact/collapsed rail control if mobile lessons need a larger document area.

## Alternatives considered

- Keep the old student-only stage and give the teacher a different layout. Rejected because the two roles should learn one consistent meeting-room structure, and the teacher also needs a clear view of the student's camera.
- Place both face cameras as floating overlays on top of the document. Rejected for the initial version because overlays can cover the writing area; a dedicated rail preserves the shared content.
- Infer microphone UI state only from remote track `mute`/`unmute` events. Rejected because a receiver track can remain visually unmuted after its sender calls `replaceTrack(null)`; a lightweight explicit state message makes the indicator match the owner's control, while the audio itself remains peer-to-peer.
- Negotiate a new media section when someone unmutes. Rejected because it adds avoidable signaling and renegotiation to a frequent control action.

## How to verify the decision

1. Enter the teacher room before the student and confirm it waits. Enter the student room and confirm both stay in the meeting surface as WebRTC connects.
2. Confirm the teacher sees one student video and the student receives up to two teacher views.
3. Toggle each microphone and confirm the peer hears the audio and sees the correct microphone state without a new offer/answer exchange.
4. Switch or enable cameras from in-room settings and confirm the remote video updates while the existing transceiver MID stays stable.
5. Disconnect either participant and confirm the other stays in the meeting room, then re-enter and confirm a fresh peer connection is negotiated.
6. Resize the connected screen to a narrow and short viewport and confirm there are no page scrollbars.
