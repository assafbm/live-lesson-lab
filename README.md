# Live Lesson Lab

A web app for private lessons, with video views for the `face` and `document` roles. The project is built incrementally to learn React, TypeScript, WebSocket, and WebRTC.

## Requirements

- Node.js 22 or newer
- npm 10 or newer

## Run locally

On `codex/room-access`, teachers also have server-enforced invitation expiry,
lock/unlock, renewal and End lesson controls. This branch includes screen sharing
and uses protocol v6; it is not deployed. See [room-access decisions](docs/decisions/0008-room-access-controls.md).

On `codex/screen-sharing`, teacher Settings includes Share screen. This feature
branch is not deployed to the AWS pilot. See [screen-sharing notes](docs/screen-sharing.md)
for behavior, test limits and the saved baseline.

```sh
npm install
npm run dev
```

Vite runs at `http://localhost:5173`; the signaling server health endpoint is at `http://localhost:3001/health`. During development, Vite proxies `/signal` WebSocket connections to the signaling server.

For a local lesson, choose the teacher cameras and create a lesson link. The teacher then presses **Join lesson** to enter the waiting room. Open the copied student link in a second browser; the student chooses a camera and presses **Join lesson** as well. Teacher links use `?role=teacher`; student invitations use `?role=student&room=...`. Older `?room=...` links remain supported. The WebRTC call starts only when both roles have entered the room. Camera and microphone access require a secure browser context: `localhost` works in development, while another device needs an HTTPS origin. A plain `http://<LAN-IP>` address will generally not allow media capture.

The current deployment direction is a domain-free AWS pilot in `eu-north-1`, using a CloudFront HTTPS address and API Gateway WSS address. An AWS Lambda adapter maps the shared WebSocket protocol to short-lived DynamoDB room records. The local Node.js signaling server remains available for development. WebRTC media remains peer-to-peer. TURN is a separate decision because Amazon Kinesis Video Streams is not part of AWS Free Tier. See [the current AWS decision](docs/decisions/0005-domain-free-aws-pilot.md). Do not put real student information into the pilot until teacher access control and expiring lesson invitations are implemented.

## Commands

- `npm run dev` — builds the shared types, then starts the web client and signaling server together.
- `npm run check` — type-checks all workspaces.
- `npm run build` — builds the shared package, signaling server, and web client.
- `npm test` — runs protocol, signaling, AWS-handler and Chrome fake-media regression tests. Install Google Chrome for local browser tests.

## Structure

- `apps/web` — React and Vite user interface.
- `services/signaling` — local Node.js WebSocket server for signaling.
- `services/aws-signaling` — AWS Lambda adapter for API Gateway WebSocket messages.
- `packages/shared` — shared protocol and media-role types.
- `docs` — architecture, decisions, and testing plan.
- `infra/aws` — AWS CDK stack for API Gateway, Lambda, temporary DynamoDB room state, private S3, and CloudFront.

The signaling server keeps one teacher and one student per in-memory room and relays WebRTC setup messages. Each participant can enter or exit the meeting independently; the other stays in the room and waits for them to return. Both participants can optionally send microphone audio. The teacher can send up to two distinct camera tracks; the student receives the selected face and document roles and can send one camera track back. If both teacher roles use one physical camera, the browser captures and sends it once. In the meeting room, both participants see the document view in the center, their own face camera above the other participant's face camera in the right rail, and microphone and disconnect controls along the bottom.

## Documentation

- [Development decisions and alternatives](docs/development-decisions.md)
- [Security, media and UI review — 2026-11-06](docs/review-2026-11-06.md)
- [Stabilization release and live verification](docs/deployment-2026-11-06.md)
- [Screen sharing and recording sequence](docs/decisions/0007-screen-sharing-and-recording.md)

- [Architecture](docs/architecture.md)
- [Decision 0001: Monorepo and signaling](docs/decisions/0001-monorepo-and-signaling.md)
- [Decision 0002: Connected meeting room](docs/decisions/0002-connected-meeting-room.md)
- [Testing strategy](docs/testing.md)
- [Learning log](docs/learning-log.md)
