import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { isInvitationOpen, DEFAULT_LESSON_MINUTES, MAX_SIGNALING_BYTES, PROTOCOL_VERSION, parseClientMessage } from "@live-lesson-lab/shared";
import type { ClientMessage, ServerMessage } from "@live-lesson-lab/shared";
import { createIdentityVerifier, type LessonIdentity } from "@live-lesson-lab/shared/identity";

type Room = {
  durationMinutes: number;
  endsAt?: number;
  ownerUserId: string;
  locked: boolean;
  joinExpiresAt: number;
  teacher: WebSocket;
  // A participant can own a room slot without currently being inside the call.
  teacherEntered: boolean;
  student: WebSocket | null;
  studentEntered: boolean;
};

type Membership = {
  roomId: string;
  role: "teacher" | "student";
};

// Hosted Node services usually provide PORT; SIGNALING_PORT remains useful locally.
const port = Number(process.env.PORT ?? process.env.SIGNALING_PORT ?? 3001);
const rooms = new Map<string, Room>();
const memberships = new Map<WebSocket, Membership>();
const identities = new Map<WebSocket, LessonIdentity>();
const verifyIdentity = process.env.AUTH_USER_POOL_ID && process.env.AUTH_CLIENT_ID
  ? createIdentityVerifier(process.env.AUTH_USER_POOL_ID, process.env.AUTH_CLIENT_ID) : null;
// Anonymous mode is a loopback-only development aid, never a production fallback.
const anonymousLocal = !process.env.AUTH_USER_POOL_ID && !process.env.AUTH_CLIENT_ID
  && process.env.NODE_ENV !== "production" && process.env.ALLOW_ANONYMOUS_LOCAL !== "false";
if (!verifyIdentity && !anonymousLocal) throw new Error("Configure Cognito identity before serving authenticated lessons.");
const serveWebApp = process.env.NODE_ENV === "production";
// The built web app is a sibling workspace in this monorepo. Resolving from
// this compiled file keeps the path stable regardless of the process cwd.
const webRoot = resolve(fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)));
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

async function serveBuiltWebApp(pathname: string, response: import("node:http").ServerResponse) {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    response.writeHead(400);
    response.end("Invalid URL path");
    return;
  }

  const requestedPath = resolve(webRoot, relativePath || "index.html");
  if (requestedPath !== webRoot && !requestedPath.startsWith(`${webRoot}${sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  // Client-side routes such as ?role=student are served by the same app shell.
  const filePath = existsSync(requestedPath) ? requestedPath : resolve(webRoot, "index.html");
  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error("Requested path is not a file.");
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Web app files are unavailable. Build the web workspace first.");
  }
}

// Health checks use ordinary HTTP. WebSocket signaling is handled separately
// so availability can be checked without creating a lesson connection.
const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "signaling" }));
    return;
  }

  if (serveWebApp && request.method === "GET" && pathname !== "/signal") {
    void serveBuiltWebApp(pathname, response);
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

const webSocketServer = new WebSocketServer({ server, path: "/signal", maxPayload: MAX_SIGNALING_BYTES });

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, message: string) {
  send(socket, { type: "room-error", message });
}

function sendTiming(roomId: string, room: Room, socket?: WebSocket) {
  const message: ServerMessage = { type: "lesson-time", roomId, durationMinutes: room.durationMinutes, endsAt: room.endsAt ?? null, serverNow: Date.now() };
  if (socket) send(socket, message);
  else { send(room.teacher, message); if (room.student) send(room.student, message); }
}

function leaveRoom(socket: WebSocket, reason = "The teacher connection closed. Ask for a new lesson link.") {
  const membership = memberships.get(socket);
  if (!membership) return;

  memberships.delete(socket);
  const room = rooms.get(membership.roomId);
  if (!room) return;

  if (membership.role === "teacher") {
    rooms.delete(membership.roomId);
    if (room.student) {
      memberships.delete(room.student);
      send(room.student, { type: "room-closed", roomId: membership.roomId, reason });
    }
    return;
  }

  room.student = null;
  room.studentEntered = false;
  if (room.teacherEntered) send(room.teacher, { type: "peer-left", roomId: membership.roomId });
}

function exitMeeting(socket: WebSocket, membership: Membership, room: Room) {
  // Exiting closes only this participant's peer connection. Keep their room
  // membership so the same user can enter again without creating a new link.
  if (membership.role === "teacher") {
    room.teacherEntered = false;
    if (room.studentEntered && room.student) send(room.student, { type: "peer-left", roomId: membership.roomId });
  } else {
    room.studentEntered = false;
    if (room.teacherEntered) send(room.teacher, { type: "peer-left", roomId: membership.roomId });
  }
}

function relay(socket: WebSocket, membership: Membership, room: Room, message: ClientMessage) {
  if (!room.teacherEntered || !room.studentEntered) return;
  const peer = membership.role === "teacher" ? room.student : room.teacher;
  if (!peer || peer.readyState !== WebSocket.OPEN) {
    sendError(socket, "The other participant is not connected yet.");
    return;
  }

  if (message.type === "audio-state" || message.type === "participant-name") {
    send(peer, message);
    return;
  }

  if (message.type === "video-role-state") {
    if (membership.role !== "teacher") {
      sendError(socket, "Only the teacher can update video role mapping.");
      return;
    }
    send(peer, message);
    return;
  }

  if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate") {
    if (message.type === "offer" && membership.role !== "teacher") {
      sendError(socket, "Only the teacher can initiate the WebRTC offer.");
      return;
    }
    if (message.type === "answer" && membership.role !== "student") {
      sendError(socket, "Only the student can answer the WebRTC offer.");
      return;
    }
    send(peer, message);
  }
}

function handleMessage(socket: WebSocket, message: ClientMessage) {
  if (message.type === "authenticate") return;
  // A WebSocket keepalive can preserve quiet sessions through intermediaries;
  // the actual lesson media continues directly between browsers.
  if (message.type === "heartbeat") {
    const membership = memberships.get(socket);
    const room = membership && rooms.get(membership.roomId);
    if (membership && room) sendTiming(membership.roomId, room, socket);
    send(socket, { type: "server-ready", protocolVersion: PROTOCOL_VERSION, authenticationRequired: !anonymousLocal });
    return;
  }

  if (message.type === "create-room") {
    const identity = identities.get(socket);
    if (!identity || "guest" in identity) {
      send(socket, { type: "authentication-error", message: "Teachers must sign in with a verified email." });
      return;
    }
    if (memberships.has(socket)) {
      sendError(socket, "Leave the current room before creating another one.");
      return;
    }

    const roomId = randomUUID();
    const durationMinutes = message.durationMinutes ?? DEFAULT_LESSON_MINUTES;
    const room: Room = { durationMinutes, ownerUserId: identities.get(socket)!.userId, teacher: socket, teacherEntered: false, student: null, studentEntered: false,
      locked: false, joinExpiresAt: Date.now() + durationMinutes * 60000 };
    rooms.set(roomId, room);
    memberships.set(socket, { roomId, role: "teacher" });
    send(socket, { type: "room-created", roomId });
    sendTiming(roomId, room, socket);
    send(socket, { type: "room-access", roomId, locked: room.locked, joinExpiresAt: room.joinExpiresAt });
    return;
  }

  if (message.type === "join-room") {
    if (memberships.has(socket)) {
      sendError(socket, "Leave the current room before joining another one.");
      return;
    }

    const room = rooms.get(message.roomId);
    if (!room) {
      sendError(socket, "This lesson link is invalid or the room has ended.");
      return;
    }
    if (room.student) {
      sendError(socket, "This lesson already has a student connected.");
      return;
    }
    if (room.ownerUserId === identities.get(socket)?.userId) {
      sendError(socket, "Use a different verified account for the student role.");
      return;
    }
    if (!isInvitationOpen(room)) {
      sendError(socket, "This invitation is locked or expired. Ask the teacher to reopen access.");
      return;
    }

    if (!identities.has(socket)) identities.set(socket, {
      userId: `guest-${randomUUID()}`, guest: true, expiresAt: Math.floor(Date.now() / 1000) + 8 * 60 * 60
    });
    room.student = socket;
    room.studentEntered = true;
    memberships.set(socket, { roomId: message.roomId, role: "student" });
    send(socket, { type: "room-joined", roomId: message.roomId });
    sendTiming(message.roomId, room, socket);
    if (room.teacherEntered) send(room.teacher, { type: "peer-joined", roomId: message.roomId });
    return;
  }

  if (message.type === "set-room-locked" || message.type === "renew-invitation" || message.type === "end-room" || message.type === "extend-lesson") {
    const membership = memberships.get(socket);
    const room = rooms.get(message.roomId);
    if (!membership || membership.role !== "teacher" || membership.roomId !== message.roomId || room?.teacher !== socket
      || room.ownerUserId !== identities.get(socket)?.userId) {
      sendError(socket, "Only the room's teacher can change access or end the lesson.");
      return;
    }
    if (message.type === "end-room") {
      const reason = "The teacher ended this lesson.";
      leaveRoom(socket, reason);
      send(socket, { type: "room-closed", roomId: message.roomId, reason });
      return;
    }
    if (message.type === "extend-lesson") {
      // Compare the displayed deadline: repeated clicks/retries cannot extend
      // the same deadline twice. Extending never changes the admission lock.
      if (room.endsAt === message.expectedEndsAt && room.durationMinutes <= 465) {
        room.durationMinutes += 15;
        room.endsAt = Math.max(Date.now(), room.endsAt) + 15 * 60000;
        room.joinExpiresAt = Math.max(room.joinExpiresAt, room.endsAt);
      }
      sendTiming(message.roomId, room);
    }
    if (message.type === "set-room-locked") room.locked = message.locked;
    // Renewal extends this same bearer link; it is deliberately not described
    // as token rotation or revocation. Locking does not expel an admitted peer.
    if (message.type === "renew-invitation") room.joinExpiresAt = Date.now() + room.durationMinutes * 60000;
    send(socket, { type: "room-access", roomId: message.roomId, locked: room.locked, joinExpiresAt: room.joinExpiresAt });
    return;
  }

  if (message.type === "enter-room" || message.type === "exit-room") {
    const membership = memberships.get(socket);
    if (!membership || membership.roomId !== message.roomId) {
      sendError(socket, "Join the lesson before entering or leaving its meeting room.");
      return;
    }
    const room = rooms.get(membership.roomId);
    if (!room) {
      sendError(socket, "This lesson has ended.");
      return;
    }
    if (message.type === "exit-room") {
      exitMeeting(socket, membership, room);
      send(socket, { type: "room-exited", roomId: message.roomId });
      return;
    }

    if (membership.role === "teacher") {
      room.teacherEntered = true;
      if (!room.endsAt) {
        room.endsAt = Date.now() + room.durationMinutes * 60000;
        room.joinExpiresAt = Math.max(room.joinExpiresAt, room.endsAt);
        send(socket, { type: "room-access", roomId: membership.roomId, locked: room.locked, joinExpiresAt: room.joinExpiresAt });
      }
    }
    else room.studentEntered = true;
    send(socket, { type: "room-entered", roomId: message.roomId });
    sendTiming(message.roomId, room);
    if (room.teacherEntered && room.studentEntered) send(room.teacher, { type: "peer-joined", roomId: message.roomId });
    return;
  }

  if (message.type === "leave-room") {
    leaveRoom(socket);
    return;
  }

  const membership = memberships.get(socket);
  if (!membership || message.roomId !== membership.roomId) {
    sendError(socket, "Join a lesson before sending WebRTC messages.");
    return;
  }

  const room = rooms.get(membership.roomId);
  if (!room) {
    sendError(socket, "This lesson has ended.");
    return;
  }

  relay(socket, membership, room, message);
}

webSocketServer.on("connection", (socket) => {
  if (anonymousLocal) identities.set(socket, { userId: `local-${randomUUID()}`, email: "development-only@localhost", expiresAt: Number.MAX_SAFE_INTEGER });
  // A small versioned greeting confirms connectivity before room messages begin.
  send(socket, { type: "server-ready", protocolVersion: PROTOCOL_VERSION, authenticationRequired: !anonymousLocal });
  let queue = Promise.resolve();

  // A per-socket token bucket permits ICE bursts but bounds sustained abuse.
  let tokens = 80;
  let lastRefill = Date.now();
  socket.on("error", () => leaveRoom(socket));
  socket.on("message", (data, isBinary) => {
    const now = Date.now();
    tokens = Math.min(80, tokens + (now - lastRefill) / 1000 * 20);
    lastRefill = now;
    if (tokens < 1) { socket.close(1008, "Signaling rate limit exceeded"); return; }
    tokens -= 1;
    if (isBinary) {
      sendError(socket, "Binary messages are not supported by the signaling protocol.");
      return;
    }

    const message = parseClientMessage(data.toString());
    if (!message) {
      sendError(socket, "The signaling message is invalid or unsupported.");
      return;
    }
    queue = queue.then(async () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (message.type === "authenticate") {
        if (!verifyIdentity) { sendError(socket, "Identity is not enabled in this local session."); return; }
        const identity = await verifyIdentity(message.token);
        const current = identities.get(socket);
        if (current && current.userId !== identity.userId) throw new Error("Account switch requires a new connection");
        if (socket.readyState !== WebSocket.OPEN) return;
        identities.set(socket, identity);
        send(socket, { type: "authenticated" });
        return;
      }
      const identity = identities.get(socket);
      if (!identity || identity.expiresAt <= Date.now() / 1000) {
        if (message.type === "heartbeat") {
          send(socket, { type: "server-ready", protocolVersion: PROTOCOL_VERSION, authenticationRequired: true });
          return;
        }
        if (message.type === "join-room") {
          if (identity) { sendError(socket, "Your session expired. Refresh the invitation to rejoin."); return; }
          handleMessage(socket, message);
          return;
        }
        send(socket, { type: "authentication-error", message: "Sign in with a verified email to continue." });
        return;
      }
      handleMessage(socket, message);
    }).catch(() => send(socket, { type: "authentication-error", message: "Sign in with a verified email to continue." }));
  });

  socket.on("close", () => { leaveRoom(socket); identities.delete(socket); });
});

server.listen(port, anonymousLocal ? "127.0.0.1" : "0.0.0.0", () => {
  console.log(`Signaling server listening on http://localhost:${port}`);
});
