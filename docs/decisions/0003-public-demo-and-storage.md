# Decision 0003: Public demo, role links, and persistence

## Status

Superseded by [Decision 0004](0004-aws-pilot.md). This decision records the earlier Render demo plan and remains for historical context.

## Context

The current application works locally, but a second device needs a public HTTPS page and a public secure WebSocket signaling endpoint. The existing room is temporary and is held in signaling-server memory. Live audio and video travel through WebRTC between the participant browsers; the signaling service carries setup and room messages only.

## Decisions

- Make role intent visible in links: teacher setup uses `?role=teacher`, while student invitations use `?role=student&room=<roomId>`. Continue to accept the older `?room=<roomId>` student URL.
- Use one Render web service for the first public demo. The Node.js process serves the built Vite files and the WebSocket signaling endpoint from the same HTTPS origin; this keeps the first deployment straightforward and avoids cross-origin setup.
- Keep `VITE_SIGNALING_URL` available for a future split deployment. The client defaults to the current origin's `/signal` endpoint, and local development continues to use Vite's same-origin proxy.
- Listen on the hosting platform's `PORT` variable, while retaining `SIGNALING_PORT` for local development.
- Send a lightweight heartbeat from each open browser signaling connection every five minutes. Render's free service needs inbound traffic to avoid scaling down during an otherwise quiet WebRTC lesson; the heartbeat carries no lesson or media data.
- Do not add a database for the first public demo. Rooms, peer presence, offers, answers, and ICE candidates are temporary session data. Camera and microphone tracks remain peer-to-peer media and are not database records.
- Consider a database only when persistent accounts, schedules, preferences, or lesson history become a concrete requirement. A database must not be used as a substitute for WebRTC media transport.
- Treat free hosting as a learning/demo target, not a reliability promise. The signaling server may sleep or restart, and some networks will need TURN to carry media.

## Next work

1. Make a private Git repository the source of deployment artifacts; do not publish source publicly by default.
2. Connect the repository to Render and deploy the included `render.yaml` Blueprint.
3. Test with two browsers on different devices and networks. Check camera/microphone permission, role-specific links, cold starts, reconnection, and whether direct ICE succeeds.
4. Add a TURN relay if the network test shows that direct peer-to-peer media is blocked.
5. Revisit a database only when the app needs durable user or lesson information.

## Consequences

The app can be reached outside localhost after deployment, while lesson state remains ephemeral. A signaling-server restart ends active rooms. The heartbeat helps keep active signaling connections from being treated as idle, but platform restarts and the free service's post-idle cold start can still delay joining. The lack of TURN can limit which networks connect. Hosting the app does not make the media pass through the host; it hosts the web client and signaling while WebRTC continues to carry media between peers when the network allows it. The first Render deployment uses one service for simple learning; the web client and signaling can be separated later if the project needs independent scaling or release cycles.
