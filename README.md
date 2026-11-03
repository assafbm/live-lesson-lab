# Live Lesson Lab

A web app for private lessons, with video views for the `face` and `document` roles. The project is built incrementally to learn React, TypeScript, WebSocket, and WebRTC.

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Run locally

```sh
npm install
npm run dev
```

Vite runs at `http://localhost:5173`; the signaling server health endpoint is at `http://localhost:3001/health`. During development, Vite proxies `/signal` WebSocket connections to the signaling server.

For a local lesson, choose the teacher cameras and create a lesson link. The teacher then presses **Login** to enter the waiting room. Open the copied student link in a second browser; the student chooses a camera and presses **Login** as well. Teacher links use `?role=teacher`; student invitations use `?role=student&room=...`. Older `?room=...` links remain supported. The WebRTC call starts only when both roles have entered the room. Camera and microphone access require a secure browser context: `localhost` works in development, while another device needs an HTTPS origin. A plain `http://<LAN-IP>` address will generally not allow media capture.

The included Render Blueprint builds the Vite app and Node.js signaling server into one web service. The same HTTPS origin serves the page and its `/signal` secure WebSocket endpoint, so `VITE_SIGNALING_URL` can remain unset. If the two parts are split into separate hosts later, set that variable to the full `wss://.../signal` endpoint. See [the deployment and storage decision](docs/decisions/0003-public-demo-and-storage.md) for setup notes and the current database decision.

## Commands

- `npm run dev` — builds the shared types, then starts the web client and signaling server together.
- `npm run check` — type-checks all workspaces.
- `npm run build` — builds the shared package, signaling server, and web client.

## Structure

- `apps/web` — React and Vite user interface.
- `services/signaling` — WebSocket server for signaling.
- `packages/shared` — shared protocol and media-role types.
- `docs` — architecture, decisions, and testing plan.

The signaling server keeps one teacher and one student per in-memory room and relays WebRTC setup messages. Each participant can enter or exit the meeting independently; the other stays in the room and waits for them to return. Both participants can optionally send microphone audio. The teacher can send up to two distinct camera tracks; the student receives the selected face and document roles and can send one camera track back. If both teacher roles use one physical camera, the browser captures and sends it once. In the meeting room, both participants see the document view in the center, their own face camera above the other participant's face camera in the right rail, and microphone and disconnect controls along the bottom.

## Documentation

- [Architecture](docs/architecture.md)
- [Decision 0001: Monorepo and signaling](docs/decisions/0001-monorepo-and-signaling.md)
- [Decision 0002: Connected meeting room](docs/decisions/0002-connected-meeting-room.md)
- [Testing strategy](docs/testing.md)
- [Learning log](docs/learning-log.md)
