# Learning Log

This log explains the decisions and code introduced in each milestone. It focuses on what the code does, why it is arranged this way, and what to inspect while learning.

## Milestone 0 — Project skeleton

### What we built

- A React + TypeScript + Vite web app in `apps/web`.
- A Node.js + TypeScript WebSocket service in `services/signaling`.
- A shared TypeScript package in `packages/shared`.
- One root command, `npm run dev`, to start the web app and signaling service together.
- A minimal browser-to-server WebSocket handshake and an HTTP health endpoint.
- Architecture, decision, and testing notes under `docs`.

### Why use workspaces?

An npm workspace is a package inside the same repository that can depend on another local package. The web app and signaling service both consume `@live-lesson-lab/shared`, so the protocol types have one source of truth. The root scripts coordinate their commands without making them one application or one runtime process.

### How the development command works

The root `predev` script builds `shared` before `dev` starts. This matters because the shared package exports compiled JavaScript and declaration files from `packages/shared/dist`. `concurrently` then starts the Vite process and signaling process side by side; `-k` asks it to stop the other process if one exits.

### How the browser reaches the server

The browser opens a WebSocket at `/signal` on the Vite origin. Vite's development proxy forwards the WebSocket upgrade to port 3001. This keeps browser requests on one origin during development and gives us a clear boundary between the user interface and signaling service.

The signaling service uses the same HTTP server for two purposes:

1. `GET /health` returns a small JSON response for operational checks.
2. WebSocket connections at `/signal` receive a `server-ready` message.

This handshake confirms connectivity only. It does not create rooms or relay messages between participants yet.

### What React is doing

`main.tsx` mounts the React tree into the `root` element in `index.html`. `App.tsx` owns the connection state and opens the WebSocket inside `useEffect`, because opening a socket is a side effect that should follow the component lifecycle. The effect's cleanup closes the socket when the component unmounts.

React `StrictMode` may run an effect setup and cleanup an extra time in development to help reveal lifecycle mistakes. Seeing a short connect/disconnect during local development can therefore be expected; production does not use this development check.

The event handlers translate browser WebSocket events into UI state. `open`, `close`, and `error` update the connection indicator; a `server-ready` message updates the detail line.

### What the shared types do—and do not do

TypeScript interfaces help the client and server agree on message shapes while we build. They do not validate JSON received over a network at runtime. The current `JSON.parse(...) as ServerMessage` is a compile-time assertion only. Before accepting room, role, or WebRTC messages, a later milestone should add runtime validation and reject malformed or unsupported messages.

`MediaRole` names the two product concepts (`face` and `document`) without exposing physical camera IDs. Later, the app will map each role to a logical media source. If two roles share one physical camera, both can refer to the same captured source and transmitted track.

### Important boundary: signaling versus media

WebSocket signaling is the control path: it will exchange room state and WebRTC setup messages such as offers, answers, and ICE candidates. WebRTC is the media path: it carries audio and video between browsers. The signaling server in this milestone carries no media.

### Files to read in order

1. `package.json` — see the workspace list and the single development command.
2. `apps/web/vite.config.ts` — see how the browser's `/signal` WebSocket is proxied.
3. `apps/web/src/main.tsx` and `apps/web/src/App.tsx` — follow React mounting and socket lifecycle.
4. `packages/shared/src/index.ts` — inspect the shared protocol types.
5. `services/signaling/src/index.ts` — follow the health endpoint and handshake response.
6. `docs/architecture.md` and `docs/decisions/0001-monorepo-and-signaling.md` — review the broader design choices.

### Try these learning exercises

- Change the server's ready message text, restart development, and observe the client update.
- Temporarily change the signaling port and trace which configuration values must stay in sync.
- Add a new message type to the shared package, then make both the server and client handle it.
- Inspect the browser Network panel and find the WebSocket handshake and its first message.

### Not implemented yet

There are no room IDs, teacher/student roles, camera permissions, media capture, `RTCPeerConnection`, ICE exchange, dynamic track mapping, or TURN configuration. These belong to later milestones so each new concept can be introduced and verified on its own.

## Milestone 1 — Local camera selection and preview

### What we built

- A user-initiated camera permission request.
- A device picker for the `face` and `document` roles, each with a `None` option.
- A local preview for every selected role.
- Device-list refresh when the browser reports a camera was connected or removed.
- Clear messages for denied permission, no camera, camera errors, and unplugged devices.
- A capture manager that shares one stream when both roles select the same device.

### Why permission is requested from a button

Opening a camera is a privacy-sensitive action. The browser should show its permission prompt in response to a clear user gesture, so the first screen explains why access is needed and waits for the user to press **Enable cameras**.

After permission is granted, `enumerateDevices()` returns video inputs with labels. Before permission, browsers often hide labels or return limited device information. The temporary stream used to request permission is stopped immediately; selecting a role later opens the chosen camera for its preview.

### How role selection maps to a preview

The UI stores a local `deviceId` for each logical role. `None` is represented as `null`. `useCameraPreviews` makes a unique set from the two selected IDs, so if both roles select the same ID it asks the source manager for that device only once. Both preview cards then look up the same stream by ID.

The physical device ID never leaves the browser. It is a local key for selecting a capture source, not part of the future signaling protocol.

### Why there is a camera source manager

`CameraSourceManager` owns capture streams. `acquire(deviceId)` returns a lease with a stream promise and an idempotent `release()` function. Its map shares an in-flight or active capture with other consumers of the same camera, instead of calling `getUserMedia` again. When the last lease is released, the manager stops all tracks and removes the source.

The short deferred release handles a React development detail: `StrictMode` can run an effect setup, cleanup, and setup again to reveal lifecycle bugs. Deferring cleanup by one event-loop tick lets the second setup reuse the same pending request. `getUserMedia` itself cannot be cancelled, so if every consumer leaves while a permission prompt is still open, the manager stops the stream as soon as that request resolves.

### How a preview is attached

`CameraPreview` assigns a `MediaStream` to an HTML video element's `srcObject`. The video is muted and uses `playsInline` so it can autoplay as an inline preview on mobile browsers. The component clears `srcObject` when its stream changes or it unmounts; the manager owns stopping the tracks because more than one role may be viewing the same stream.

Both roles display the source with the same orientation in this milestone. When display transforms are added, each role will get its own rotate and mirror settings, plus an option to apply the same settings to both roles when they share a camera.

### Error handling and cleanup

The UI distinguishes permission denial from a missing or unreadable camera. A `devicechange` listener refreshes the picker. If a selected track ends, the preview shows a disconnect message and lets the user choose another device. React effect cleanup removes event listeners and releases every camera lease.

### Files to read

1. `apps/web/src/App.tsx` — follow permission request, device selection, and the two role cards.
2. `apps/web/src/media/useCameraPreviews.ts` — see how selected IDs become streams and how async results are cleaned up.
3. `apps/web/src/media/CameraSourceManager.ts` — inspect the shared capture map, leases, and track stopping.
4. `apps/web/src/components/CameraPreview.tsx` — see how a stream is rendered in a video element.
5. `apps/web/src/styles.css` — find the preview layout and responsive grid.

### Try these learning exercises

- Choose one camera for both roles. Notice there is one physical source in the summary and both previews show the same view.
- Choose `None` for both roles, then enable only the document role.
- Select two different cameras and compare the preview streams.
- Unplug a selected USB camera and observe the status; reconnect it and refresh the list.
- Open browser developer tools and inspect the camera permission and device-change behavior.

### Not implemented yet

The previews are local to this browser. No microphone, room, WebSocket room message, WebRTC peer connection, video transmission, layout controls, or rotation controls are included. Those remain in later milestones.

## Milestone 2 — Room and audio connection

### What we built

- A teacher can create an in-memory room and copy a student join URL.
- A student opening that URL can join the room.
- The signaling server permits one teacher and one student per room and relays only validated signaling messages.
- The teacher can optionally send microphone audio to the student over WebRTC.
- The browser exchanges an offer, answer, and ICE candidates to establish the peer connection.
- Leaving or disconnecting closes the room/peer state and stops microphone tracks.
- Camera preview orientation is now identical for both roles, even when they share one physical camera.

### Follow one lesson from start to finish

1. The teacher's browser opens a WebSocket connection to `/signal`.
2. **Create lesson link** sends `create-room`. The server generates a random room ID and stores the teacher socket in memory.
3. The teacher shares a URL containing the room ID. Opening it loads the student route; the student presses **Join lesson** to send `join-room`.
4. The server checks that the room exists and has no student yet, then sends `peer-joined` to the teacher and `room-joined` to the student.
5. The teacher creates an `RTCPeerConnection`. It adds a send-only audio transceiver. If the optional microphone setting is on, the browser asks for microphone access and the microphone track is attached with `replaceTrack`.
6. The teacher creates an SDP offer and sends it through the WebSocket. The student applies the offer, creates an answer, and sends it back through the signaling server.
7. Both browsers send ICE candidates through the server as they discover possible network paths. WebRTC then carries audio directly between the browsers when a route is available.
8. Closing the lesson or losing a socket removes the participant from the room, closes the peer connection, and stops local microphone tracks.

### Why the server keeps the room

The server needs a short-lived mapping from room ID to teacher/student WebSocket so it can route signaling to the correct peer. It does not need to store lesson data, accounts, or media. This state is in memory, so restarting the server ends all active rooms; adding persistence is outside the current scope.

### Why there is a transceiver even when audio is off

The teacher always negotiates an audio media section with send-only direction, while the student negotiates receive-only. If the teacher turns audio on, `replaceTrack` attaches the microphone without changing the negotiated connection shape. If audio is off, the transceiver carries no microphone track, and the browser does not ask for microphone permission.

### What the signaling server validates

TypeScript types help the code agree on message structure, but they do not validate incoming JSON. `parseClientMessage` checks the message type and required fields at runtime before room logic sees the payload. The server then checks that the socket belongs to the room named in each offer, answer, candidate, or audio-state message. This prevents one room member from relaying messages into a different room.

### Camera preview behavior

The face and document previews now use the same orientation. A shared camera is one local stream shown by two video elements, with no role-specific mirror transform. When rotation and mirroring controls are added, each role will have independent view settings; when both roles share a source, the interface should also offer an action to apply a setting to both roles.

### Important limits

- Video is not transmitted yet. This milestone establishes audio and room signaling only.
- The teacher uses the browser's default microphone; microphone selection is not included yet.
- Rooms exist only while the signaling process is running.
- STUN helps discover direct routes, but there is no TURN relay yet. Some networks will fail to connect.
- The room link is a random room ID, not a full authentication or expiring invite-token system.

### Files to read

1. `packages/shared/src/index.ts` — inspect the message union and runtime parser.
2. `services/signaling/src/index.ts` — follow room creation, joining, message routing, and cleanup.
3. `apps/web/src/media/useLessonSession.ts` — follow the socket and WebRTC lifecycle.
4. `apps/web/src/App.tsx` — inspect teacher controls and share-link creation.
5. `apps/web/src/components/StudentLesson.tsx` — inspect the join flow and remote audio playback.

### Try these learning exercises

- Create a room and open the student link in another browser. Watch the WebSocket frames in both developer tools.
- Toggle teacher audio and observe that the microphone is requested only after the student joins.
- Disconnect the student and watch the teacher's room return to its waiting state.
- Inspect `RTCPeerConnection.connectionState` and `iceConnectionState` while the call connects.
- Try from another network and observe why a STUN-only connection may need TURN.

### Next milestone

Camera video and role mapping are covered in Milestone 3 below. The next presentation milestone will add student-controlled layout, rotation, and mirroring without changing the transmitted media.

## Milestone 3 — Camera video and role mapping

### What we built

- The teacher and student negotiate two fixed video transceivers alongside the existing audio transceiver.
- The teacher can share zero, one, or two distinct camera sources.
- Camera changes replace sender tracks in place, so selection changes do not reload the page or renegotiate SDP.
- A `video-role-state` signaling message maps `face` and `document` to negotiated MIDs, never physical device IDs.
- The student displays two role views and can show the same received stream in both when the roles share a camera.
- The sender leases cameras through `CameraSourceManager`, sharing the exact capture already used by local previews.

### Why reserve two transceivers?

An SDP offer describes media sections (audio/video sections) before the peer connection starts. If we created and removed transceivers every time a user selected a different camera, we would need renegotiation and would have to coordinate new track identities. Reserving two video transceivers makes the connection shape stable. A source can be attached, replaced, or removed with `replaceTrack`, while the peer keeps the same two video MIDs.

### Why map by MID?

The `RTCTrackEvent` tells the student which transceiver delivered a track. Its MID is a stable identifier for that media section within the negotiated connection. The teacher sends the logical role mapping separately over the existing signaling channel. This keeps roles independent from the order of `ontrack` events and avoids exposing camera device IDs. The mapping can also point both roles at one MID when they share a camera.

### How sharing one camera avoids duplicate capture and transmission

The teacher first deduplicates the selected device IDs. It then acquires only one sender lease for that camera from `CameraSourceManager`. The local preview already uses the same manager, so both consumers receive the same `MediaStream` and track; there is no second `getUserMedia` call. Since there is one unique physical source, it occupies one sender slot. Both role names map to that sender's MID, and the student displays the same received stream twice. Two different cameras use two leases, two tracks, and two senders.

### Why replace before releasing a camera

When changing sources, the hook acquires the new source and attaches its track before it releases obsolete sender leases. That ordering ensures that releasing the old lease cannot stop a camera while the sender still depends on its track. The preview may continue to hold its own lease; in that case the old camera capture correctly remains active for the local preview.

### What to inspect in the code

1. `apps/web/src/media/useLessonSession.ts` — find the fixed transceivers, serialized source sync, `replaceTrack`, signaling message parsing, and `ontrack` MID handling.
2. `apps/web/src/media/CameraSourceManager.ts` — see why preview and sender leases share a capture.
3. `packages/shared/src/index.ts` — inspect the runtime-validated role mapping message and protocol version.
4. `services/signaling/src/index.ts` — see the teacher-only role-state relay check.
5. `apps/web/src/components/RemoteVideoView.tsx` and `StudentLesson.tsx` — follow MID lookup into the student-facing role cards.

### Important limits

- At the end of this stage, the student receives the teacher's video only. Student-to-teacher video and local layout controls are added in Milestone 4 below.
- There is no TURN server, so direct WebRTC connectivity may fail on some networks.
- Device removal recovery and full reconnect behavior remain areas for later hardening.

### Try these learning exercises

- In the browser console, inspect `RTCPeerConnection.getTransceivers()` and compare the video MIDs with the signaled `video-role-state`.
- Select one camera for both roles and observe that the role mapping contains the same MID twice.
- Change the face camera while connected and watch the sender keep its MID while its track changes.
- Turn off both roles and notice the WebRTC connection remains connected with empty video media sections.

## Milestone 4 — Two-way video and student-controlled views

### What we built

- The WebRTC connection now has three fixed video media sections with asymmetric directions: two teacher-to-student sections and one student-to-teacher section.
- The student can opt in to one camera, choose which camera to share, and see a local preview.
- The teacher receives and displays only one student video stream. The student can still receive up to two teacher streams.
- The student receives up to two teacher video roles and sends one optional face camera back. The connected-room arrangement for both participants is described in Milestone 5 below.
- The student can zoom the document view and rotate or mirror either received teacher view locally.
- If both teacher roles point to the same MID, the student can link their rotation and mirror settings.

### Why use three video sections instead of adding tracks later?

WebRTC negotiates directions for each media section in the offer and answer. The teacher creates the offer's four sections in order: audio, teacher face, teacher document, and student video. The student waits for that offer, lets `setRemoteDescription` create the matching transceivers, then binds them by MID. The student sets audio to `sendrecv`, keeps the two teacher video sections `recvonly`, and sets its camera section `sendonly` before making the answer.

We reserve the student's one outgoing section even when the camera is off. When the student enables video, `replaceTrack` attaches the selected camera track to that already-negotiated sender. This keeps a single outbound student stream and avoids an offer/answer renegotiation just to turn the camera on.

### How the camera stays single while previewing and sending

The student page uses `useCameraPreviews` for the local self-view. The lesson session separately acquires a sender lease for the same device ID. Both use the shared `CameraSourceManager`, so the preview and sender receive the same underlying `MediaStreamTrack`; the browser does not open a second camera capture for the live preview. When video is turned off, the sender replaces its track with `null`, then releases its lease. If the preview still uses the camera, its lease keeps the capture open until the preview is also turned off.

### Why the incoming student view is a separate state value

Teacher face/document streams are looked up by the MID mapping sent by the teacher. The student camera always uses the third, dedicated transceiver, so the teacher does not need another dynamic role-mapping message. In this one-teacher/one-student design, every video track received by the teacher is the student's camera; the teacher stores it as one `remoteStudentVideoStream` and renders it once.

### Why presentation controls are local

Each participant's layout is CSS and component state around a received or locally previewed `MediaStream`. Rotation and mirroring apply as transforms to a `<video>` element; document zoom changes only its displayed scale. These controls do not change the sender track or create new network streams. When one teacher camera maps to both roles, each participant can optionally keep its two local transform settings linked. Teacher transforms affect the teacher's screen, and student transforms affect the student's screen; they are intentionally independent.

### What to inspect in the code

1. `apps/web/src/media/useLessonSession.ts` — inspect how each participant creates the same three video sections with opposite directions, how the student sender uses `replaceTrack`, and how the teacher identifies the student's single incoming stream.
2. `apps/web/src/components/StudentLesson.tsx` — follow camera permission, device selection, local preview, face/document layout, and local transform state.
3. `apps/web/src/components/RemoteVideoView.tsx` — see how one stream is attached to a video element and how CSS transforms affect only the view.
4. `apps/web/src/App.tsx` — find the teacher's single student-video panel.
5. `apps/web/src/media/CameraSourceManager.ts` and `useCameraPreviews.ts` — confirm preview and sender leases share one physical capture.

### Try these learning exercises

- Open `getTransceivers()` in both browsers. Compare the three video sections and their directions from each peer's point of view.
- Join with the student camera disabled, then enable it after the connection is live. Observe that the teacher gets a video view without a new offer/answer exchange.
- Change the student's camera and watch its incoming view update while its negotiated MID remains fixed.
- Set both teacher roles to the same camera. Rotate the document view and enable linked transforms, then turn linking off and change only the face inset.
- Use `edge://webrtc-internals/` or `chrome://webrtc-internals/` to compare inbound/outbound video stats on both sides.

## Milestone 5 — Meet-style connected room

### What changed

- Both participants now prepare in a lobby before the WebRTC connection is live. The teacher can select the face and document cameras independently. The student can select one camera or continue with video off.
- Each participant can press **Login** independently. The meeting room opens immediately and shows whether it is waiting, connecting, or connected. WebRTC offer/answer begins only after both role presences are active. Its center stage shows the teacher's document view; a vertical rail stacks “You · Face” above the other participant's face video on both sides.
- The bottom toolbar has microphone and disconnect controls. The meeting surface uses the viewport height, clips overflow, and switches to a compact phone layout so the connected lesson itself does not scroll.
- Camera selection remains available from the in-room view settings, so either participant can enable, turn off, or switch their camera during the call without renegotiating.
- Both participants can send optional microphone audio. The microphone starts off, and the browser asks for microphone permission only when its owner unmutes. A small `audio-state` signaling message keeps the peer's mute indicator accurate; the audio itself still travels only through WebRTC.
- Both participants can open view settings for rotation and mirroring. The student can also zoom the received teacher document video. These controls change only the local `<video>` presentation and do not add or alter a transmitted media track.

### Why room entry and media connection are separate states

Creating a signaling room, entering the meeting, and establishing media are three different events. The teacher first creates a room and shares its link. Each role then enters the meeting independently and sees the full-screen waiting state. Only after both have entered does the teacher create an offer. The UI shows connection status until offer/answer and ICE complete, so a user can distinguish waiting for the other person from a live media connection.

The `exit-room` message ends only the caller's current meeting presence. The server keeps the role's room membership, tells the peer that the connection ended, and leaves that peer in its own meeting screen. Re-entering marks the role present again and starts a fresh offer/answer cycle. This lets either person step out without closing the other's page or destroying the share link.

### Why the student still sends one video track

The right rail shows a local face preview and a remote face feed on both screens. The student sends one face camera over the already reserved third video transceiver. The teacher receives that single stream and renders it in the lower tile. The student receives up to two teacher tracks through the first two video transceivers, and the document role remains the main stage. Moving a preview around the screen is a display choice; it does not create another camera capture or send a second copy.

### Why audio uses one `sendrecv` transceiver

The audio section is negotiated once in both directions. Each participant begins with its microphone off, so joining does not prompt for microphone access. When the user unmutes, `getUserMedia({ audio: true })` acquires the microphone and `replaceTrack` attaches it to the existing sender. When they mute, the sender is cleared and the local track is stopped. The already negotiated receive side continues to play the other participant's audio. This avoids a new offer/answer exchange for each mute toggle.

The remote microphone indicator follows an explicit `audio-state` signaling message. Some browsers do not fire a remote track `mute` event when the sender calls `replaceTrack(null)`, so relying on media events alone can leave a stale “microphone on” badge. The signaling message carries only UI state; the audio itself still travels through WebRTC. Autoplay can be blocked by browser policy, so the meeting view includes a user-gesture “Play audio” action when playback fails.

### Why the meeting layout is responsive without scrolling

The connected surface is fixed to the viewport and uses a three-row CSS grid: a small header, a `minmax(0, 1fr)` video area, and a control bar. The desktop video area splits into a flexible stage and a bounded side rail. On narrow screens, the stage stays above a short two-tile row. `min-height: 0` is important inside grid children: without it, intrinsic video sizing can force the middle row taller than the screen and introduce page scrolling.

### What to inspect in the code

1. `apps/web/src/components/MeetingRoom.tsx` — see how both roles share one in-room component, how waiting status appears, and how the audio element handles autoplay.
2. `apps/web/src/components/MeetingVideoTile.tsx` — follow a `MediaStream` into a video tile; local tiles are muted to avoid microphone feedback.
3. `apps/web/src/styles.css` — inspect the viewport grid and the narrow-screen/short-screen breakpoints.
4. `apps/web/src/media/useLessonSession.ts` — find the `sendrecv` audio transceiver, mic acquire/release path, and remote-track state events.
5. `apps/web/src/App.tsx` and `apps/web/src/components/StudentLesson.tsx` — compare how the teacher's two selected sources and the student's one selected source are placed into the shared meeting room.

### Try these learning exercises

- Log in as the teacher before the student. Inspect the screen and confirm the teacher is in the meeting room while waiting for the student; then log in as student and watch the peer connection start.
- Join with both microphones off, inspect `getTransceivers()`, and confirm the audio section is `sendrecv` on each side while no local microphone track is attached.
- Unmute first on the teacher and then on the student. Watch the other browser's audio track unmute without a new offer/answer exchange.
- Inspect `document.documentElement.scrollHeight` and `window.innerHeight` while resizing the connected room; the page should not grow taller than the viewport.
- Use browser WebRTC internals to confirm that one student video is outbound and that the student can receive up to two teacher video sections.

## Milestone 6 — Media and independent-entry fixes

### Problems fixed

- The student's selected video track is now attached after applying the teacher's remote offer. This makes the browser pair the outgoing track with the already negotiated receive section before it creates its answer.
- Student camera selection is no longer cleared by a transient `disconnected`/`failed` connection status. Keeping the selected device lets the sender retry or re-enter with the same camera instead of silently switching to video-off.
- The teacher's `ontrack` handler attaches the student's incoming stream as soon as the negotiated track is announced, so the video element is ready for the first decoded frame.
- Both participants send `audio-state` to the peer after their microphone sender is actually attached or detached. The server accepts the message from either role. This keeps the microphone indicator synchronized even on browsers whose remote track `mute` event does not follow `replaceTrack(null)`.
- Teacher and student login are independent. The teacher can create/share the room and enter before the student; the student can enter and wait before the teacher. WebRTC negotiation starts after both room presences are active.
- The disconnect button sends `exit-room`, which leaves only that participant's meeting presence. The other participant stays in the meeting and sees a waiting state; the room membership and link remain available for re-entry.
- Teacher and student sender controls rotate or mirror outgoing video pixels before WebRTC transmission. Receiver-side adjustments remain local to that receiver.
- The teacher's waiting lobby no longer renders a student camera tile. Remote student video belongs in the meeting room, after the teacher logs in.
- WebRTC diagnostics log transceiver directions and track state so a local camera preview can be distinguished from a camera track attached to the WebRTC sender and received by the peer.

### Why sender rotation uses a canvas

CSS transforms only change the pixels a browser paints in one video element. They do not change the `MediaStreamTrack` that WebRTC sends. `OutgoingVideoTransform` instead draws each camera frame to a canvas with rotation and mirroring applied, then uses `canvas.captureStream()` as the sender track. The peer receives the transformed picture itself. The same processed stream can feed the sender and the local self-preview, so the sender can check the exact orientation being shared.

The processor is keyed by physical device ID and reused when the camera is selected for another logical role. If the teacher assigns one camera to both face and document, both views point to one MID and one processed track. Their outgoing transform controls are linked because one transmitted track cannot show two different orientations simultaneously. The student's single camera uses the same processing path. Receiver-side rotation, mirroring, and zoom remain separate display-only choices, so the student can correct the document's appearance locally without changing what the teacher sends or what another participant sees.

### Why the first hosted demo uses one Render service

Locally, Vite and the Node signaling server run as two development processes. For a small public demo, the Render start process can serve Vite's already-built static files and the `/signal` WebSocket endpoint from the same Node HTTP server. This keeps the browser on one HTTPS origin and avoids configuring a second public endpoint. The service listens on the platform's `PORT`; local development still uses `SIGNALING_PORT`. Render free web services can sleep after inactivity, so this is for learning and trial use, not a reliability promise. The media itself still travels over WebRTC between browsers when their networks allow direct connectivity.

### Why the student attaches video after `setRemoteDescription`

The offer log exposed eight transceivers on the student: four pre-created transceivers with `mid: null`, followed by four new transceivers created from the teacher's offer. The answer was using the latter group, where the student-video section was `inactive` and audio was receive-only. The student now creates no transceivers before the offer; after applying it, the code binds the four real sections by MID and sets their answer directions. It then attaches the selected camera with `replaceTrack` before creating the answer. This keeps future camera changes on the same negotiated sender without renegotiation.

### Why microphone state uses signaling while sound uses WebRTC

The microphone indicator is user-interface state, while the sound is media. A sender can stop sending with `replaceTrack(null)` without every browser updating the remote track's `muted` property the same way. The client therefore sends a tiny `{ type: "audio-state", enabled }` message when the actual sender changes. The signaling server relays this state to the other role; it never receives or forwards audio samples.

### Comparing microphone processing without changing the WebRTC connection

Echo cancellation, noise suppression, and automatic gain control are capture settings, not WebRTC transceiver settings. Changing them requires a new microphone capture, but the new audio track can replace the old sender track with `replaceTrack`; the audio transceiver and offer/answer do not need to be rebuilt. The in-call settings now keep echo cancellation on and let each participant toggle noise suppression and automatic gain control independently. Both begin enabled, matching the previous browser-default behavior. The capture log reports the settings the browser actually applied, which may differ from the requested values.

This creates a controlled listening test for robotic or uneven speech: change one processing setting at a time, wait for the microphone to reconnect, and have the other participant compare. Echo cancellation stays enabled because full-duplex lessons can feed remote speaker audio back into a nearby microphone. Receive statistics add packet-discard and fractional-millisecond jitter values alongside packet loss, audio level, and concealed samples. A stable packet count alone proves that RTP packets arrive; it does not prove that the captured voice sounds natural. Concealed samples are audio the receiver synthesizes to fill gaps before playback, so they help identify interruptions that a packet-loss count alone may not explain.

The current microphone settings are local to each browser and are not signaled to the peer. The capture stream remains local, and only the resulting audio track travels through the peer connection. No audio is recorded or stored.

### Why exit is different from leave

`exit-room` means “leave the live meeting but keep my room membership.” It lets someone return using the same browser session and preserves the existing student link. `leave-room` means “remove this socket from the room,” which is still used when the page is torn down. Keeping these actions separate makes the in-room disconnect button predictable and avoids treating a temporary step away as ending the lesson.

### What to inspect

1. `packages/shared/src/index.ts` — protocol version 5, heartbeat, and the `enter-room`/`exit-room` messages.
2. `services/signaling/src/index.ts` — separate room membership from `teacherEntered`/`studentEntered` presence.
3. `apps/web/src/media/useLessonSession.ts` — `handleOffer`, student `replaceTrack`, `audio-state`, and role-specific re-entry.
4. `apps/web/src/App.tsx` and `apps/web/src/components/StudentLesson.tsx` — independent Login controls and disconnect-to-lobby behavior.

### Try these exercises

- Log in as teacher only, then student only; observe both waiting states and the transition to connection once both are present.
- Disconnect the teacher while the student stays in the meeting, then have the teacher log in again. Observe the fresh offer/answer exchange.
- Repeat with the student disconnecting and re-entering. Observe that the teacher remains on the meeting screen.
- Toggle the teacher microphone and watch the student badge update even if no remote audio packets arrive while muted.
