// Keep protocol versioning in one package so client and server can reject
// accidental mismatches before they start exchanging room messages.
export const PROTOCOL_VERSION = 7 as const;
export const INVITATION_LIFETIME_MS = 30 * 60 * 1000;

// Fixed invitation expiry is distinct from routing TTL. Missing fields from
// an older room fail closed; only the server's clock decides admission.
export function isInvitationOpen(access: { locked?: boolean; joinExpiresAt?: number }, now = Date.now()): boolean {
  return access.locked === false && typeof access.joinExpiresAt === "number"
    && Number.isFinite(access.joinExpiresAt) && access.joinExpiresAt > now;
}

// Logical media roles never expose physical device IDs to the remote peer.
export type MediaRole = "face" | "document";
export type ParticipantRole = "teacher" | "student";
export type VideoRoleState = {
  face: string | null;
  document: string | null;
};

export type IceCandidatePayload = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

// This is the browser-to-server control protocol. The server relays WebRTC
// setup messages but does not inspect or forward audio/video media.
export type ClientMessage =
  | { type: "authenticate"; token: string }
  | { type: "heartbeat" }
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  | { type: "enter-room"; roomId: string }
  | { type: "exit-room"; roomId: string }
  | { type: "leave-room" }
  | { type: "set-room-locked"; roomId: string; locked: boolean }
  | { type: "renew-invitation"; roomId: string }
  | { type: "end-room"; roomId: string }
  | { type: "offer"; roomId: string; sdp: string }
  | { type: "answer"; roomId: string; sdp: string }
  | { type: "ice-candidate"; roomId: string; candidate: IceCandidatePayload }
  | { type: "audio-state"; roomId: string; enabled: boolean }
  | { type: "video-role-state"; roomId: string; roles: VideoRoleState };

export type ServerMessage =
  | { type: "server-ready"; protocolVersion: typeof PROTOCOL_VERSION; authenticationRequired?: boolean }
  | { type: "authenticated" }
  | { type: "authentication-error"; message: string }
  | { type: "room-created"; roomId: string }
  | { type: "room-access"; roomId: string; locked: boolean; joinExpiresAt: number }
  | { type: "room-joined"; roomId: string }
  | { type: "room-entered"; roomId: string }
  | { type: "room-exited"; roomId: string }
  | { type: "peer-joined"; roomId: string }
  | { type: "peer-left"; roomId: string }
  | { type: "room-closed"; roomId: string; reason: string }
  | { type: "room-error"; message: string }
  | { type: "offer"; roomId: string; sdp: string }
  | { type: "answer"; roomId: string; sdp: string }
  | { type: "ice-candidate"; roomId: string; candidate: IceCandidatePayload }
  | { type: "audio-state"; roomId: string; enabled: boolean }
  | { type: "video-role-state"; roomId: string; roles: VideoRoleState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIceCandidate(value: unknown): value is IceCandidatePayload {
  if (!isRecord(value)) return false;
  return typeof value.candidate === "string" && value.candidate.length <= 4096
    && (isMid(value.sdpMid) || value.sdpMid === null)
    && (value.sdpMLineIndex === null || (typeof value.sdpMLineIndex === "number" && Number.isInteger(value.sdpMLineIndex) && value.sdpMLineIndex >= 0 && value.sdpMLineIndex < 32))
    && (value.usernameFragment === undefined || value.usernameFragment === null || (typeof value.usernameFragment === "string" && value.usernameFragment.length <= 256));
}

function isMid(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,32}$/.test(value);
}

function isRoomId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

// API Gateway has a 32 KiB frame limit. Bound the encoded envelope before
// JSON parsing and use the same limit in both signaling implementations.
export const MAX_SIGNALING_BYTES = 32 * 1024;

// TypeScript types disappear at runtime, so every WebSocket payload must be
// parsed and checked before the server treats it as a protocol message.
export function parseClientMessage(payload: string): ClientMessage | null {
  if (payload.length > MAX_SIGNALING_BYTES || new TextEncoder().encode(payload).byteLength > MAX_SIGNALING_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "authenticate":
      return typeof value.token === "string" && value.token.length > 0 && value.token.length <= 16000
        ? { type: "authenticate", token: value.token } : null;
    case "heartbeat":
    case "create-room":
    case "leave-room":
      return { type: value.type };
    case "enter-room":
    case "exit-room":
    case "join-room":
    case "renew-invitation":
    case "end-room":
      return isRoomId(value.roomId)
        ? { type: value.type, roomId: value.roomId }
        : null;
    case "set-room-locked":
      return isRoomId(value.roomId) && typeof value.locked === "boolean"
        ? { type: value.type, roomId: value.roomId, locked: value.locked } : null;
    case "offer":
    case "answer":
      return isRoomId(value.roomId) && typeof value.sdp === "string" && value.sdp.length > 0
        ? { type: value.type, roomId: value.roomId, sdp: value.sdp }
        : null;
    case "ice-candidate":
      return isRoomId(value.roomId) && isIceCandidate(value.candidate)
        ? { type: value.type, roomId: value.roomId, candidate: {
          candidate: value.candidate.candidate,
          sdpMid: value.candidate.sdpMid,
          sdpMLineIndex: value.candidate.sdpMLineIndex,
          ...(value.candidate.usernameFragment !== undefined ? { usernameFragment: value.candidate.usernameFragment } : {})
        } }
        : null;
    case "audio-state":
      return isRoomId(value.roomId) && typeof value.enabled === "boolean"
        ? { type: value.type, roomId: value.roomId, enabled: value.enabled }
        : null;
    case "video-role-state": {
      if (!isRoomId(value.roomId) || !isRecord(value.roles)) return null;
      const { face, document } = value.roles;
      if ((!isMid(face) && face !== null) || (!isMid(document) && document !== null)) return null;
      return { type: value.type, roomId: value.roomId, roles: { face, document } };
    }
    default:
      return null;
  }
}
