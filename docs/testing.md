# Testing strategy

## Milestone 0

- `npm run check` type-checks all workspaces.
- `npm run build` builds the shared package, signaling server, and Vite client.
- Manual check: run `npm run dev`, open the welcome screen, check the WebSocket status, and request `GET /health`.

## Milestone 1

- Type-check and build the web workspace.
- In a browser with camera access, grant permission and confirm video inputs and labels appear.
- Select `None`, one camera, the same camera for both roles, and two distinct cameras when available.
- Confirm a shared camera produces one physical source capture with two local previews.
- Deny permission, disconnect a selected camera, and check that the UI remains usable and explains the issue.
- Leave the page and confirm camera indicator lights turn off after tracks are released.

## Milestone 2

- Open the teacher page and create a room; confirm a student link appears.
- Open the link in a second browser and join; confirm both participants see connection state changes.
- Enable the teacher microphone and confirm the student hears audio. Disable it and confirm the audio stops.
- Leave from either side and confirm the other side sees the room/peer close and microphone tracks are released.
- Try an invalid room ID and a third participant; confirm the server rejects both cases.
- Repeat on two computers or networks before relying on the connection outside localhost; TURN is not configured yet.
- For camera or microphone access on a second device, use HTTPS. Browsers treat `localhost` as secure for development, but a plain HTTP LAN address is not a secure media origin.

## Milestone 3

- Create a lesson with both camera roles set to `None`; confirm the call connects with empty video placeholders.
- Select one role and confirm only that student view displays video; select two different cameras and confirm both views display distinct images.
- Select the same physical camera for both roles and confirm both student views show the same image while the browser captures that device once.
- Change a camera selection during a connected lesson and confirm the student view updates without reloading or reconnecting.
- Turn a role off during a call and confirm its view returns to the waiting placeholder.
- Leave from either side and confirm sender leases release; when no preview uses the camera, its browser capture indicator turns off.
- Confirm audio still works alongside 0, 1, and 2 video sources.

## Milestone 4

- Join from the student browser with its camera off; confirm the lesson and teacher views still work and the teacher sees the student-camera placeholder.
- Enable one student camera and confirm the student sees a local preview while the teacher receives one video view.
- Change the student's selected camera during the connected lesson; confirm the teacher view changes without renegotiation or page reload.
- Confirm the teacher receives exactly one student video stream even though the student receives up to two teacher role streams.
- Confirm the student receives both the document and face roles, with sender transforms already applied to the outgoing pixels.
- When teacher face/document roles share the same camera, confirm they use one outgoing track and their sender rotation/mirror settings stay linked.
- Leave the lesson and confirm both local preview and outgoing student camera stop when no other lease uses the device.

## Milestone 5 — Meeting room experience

- Before connecting, confirm both roles see a setup/lobby screen and the teacher can independently choose face and document cameras.
- Log in as teacher before the student and confirm the teacher enters a waiting room. Then log in as the student and confirm WebRTC begins only after both are present.
- Confirm the document view occupies the central stage and the right rail shows the local face view above the remote face view for both roles.
- Confirm the teacher receives one student camera only, even though the student receives up to two teacher views.
- Toggle the microphone from each browser. Confirm it starts muted, permission is requested only when unmuting, the other browser hears the audio, and the peer's mic indicator changes on both mute and unmute.
- Open view settings during the call, enable or switch each participant's camera, and confirm the remote video changes without a new offer/answer exchange.
- Briefly interrupt/recover the network or exit and re-enter. Confirm the student's selected camera remains selected and is sent again.
- Disconnect from each role and confirm only that participant returns to the lobby; the peer stays in the meeting room with a waiting status. Re-enter from each side and confirm the call reconnects.
- Resize desktop and narrow/mobile viewports, including short landscape heights. Confirm the connected screen has no document scrollbars and all video tiles and controls remain visible.
- Change the teacher's outgoing document rotation or mirror setting and confirm the student receives the transformed picture. Then rotate or mirror the student's received document locally and confirm the teacher's view is unchanged.
- Change the teacher's outgoing face transform and the student's outgoing camera transform. Confirm each peer receives the change and each sender's self-preview matches its outgoing image.
- Select one physical camera for both teacher roles, change its outgoing transform, and confirm both received views stay linked while the camera is captured once and mapped to one MID.
- Open student view settings and confirm rotate, mirror, and zoom adjust only the student's display of the teacher's received video.
- If browser autoplay blocks remote audio, confirm the in-room “Play audio” action starts playback.

## Later milestones

### Public demo on Render

- Create the Render services from the root `render.yaml` Blueprint using a private Git repository.
- Confirm the root URL serves the React application over HTTPS and `/health` returns an OK response.
- Confirm `/signal` accepts a secure WebSocket connection and that the browser receives `server-ready`.
- Leave a connected lesson idle for more than fifteen minutes and confirm the five-minute application heartbeat keeps signaling alive.
- Create a teacher room, open its student invitation on a different device, and test microphone and camera permissions.
- Repeat after the signaling service has been idle. Expect the first request to take longer on the free plan.
- Test from different networks. A successful signaling connection does not prove direct WebRTC media can pass through every NAT or firewall; add TURN if needed.

1. Unit tests for the protocol and message validation, including malformed messages and incompatible versions.
2. Server tests for rooms, participant roles, room isolation, and disconnects.
3. Browser tests for media permissions, one camera, two cameras, a shared camera, and no cameras.
4. WebRTC tests in two browsers: offer/answer, ICE, received tracks, camera replacement, and cleanup on exit.
5. Manual tests on two computers and different networks, including TURN, device removal, permission denial, and audio autoplay.

A successful localhost connection is not proof that lessons will work reliably over the internet.
