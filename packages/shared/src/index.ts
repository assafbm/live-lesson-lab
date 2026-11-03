// Keep protocol versioning in one package so client and server can reject
// accidental mismatches before they start exchanging room messages.
export const PROTOCOL_VERSION = 5 as const;

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
  | { type: "heartbeat" }
  | { type: "create-room" }
  | { type: "join-room"; roomId: string }
  | { type: "enter-room"; roomId: string }
  | { type: "exit-room"; roomId: string }
  | { type: "leave-room" }
  | { type: "offer"; roomId: string; sdp: string }
  | { type: "answer"; roomId: string; sdp: string }
  | { type: "ice-candidate"; roomId: string; candidate: IceCandidatePayload }
  | { type: "audio-state"; roomId: string; enabled: boolean }
  | { type: "video-role-state"; roomId: string; roles: VideoRoleState };

export type ServerMessage =
  | { type: "server-ready"; protocolVersion: typeof PROTOCOL_VERSION }
  | { type: "room-created"; roomId: string }
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
  return typeof value.candidate === "string"
    && (typeof value.sdpMid === "string" || value.sdpMid === null)
    && (typeof value.sdpMLineIndex === "number" || value.sdpMLineIndex === null)
    && (value.usernameFragment === undefined || typeof value.usernameFragment === "string" || value.usernameFragment === null);
}

// TypeScript types disappear at runtime, so every WebSocket payload must be
// parsed and checked before the server treats it as a protocol message.
export function parseClientMessage(payload: string): ClientMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "heartbeat":
    case "create-room":
    case "leave-room":
      return { type: value.type };
    case "enter-room":
    case "exit-room":
    case "join-room":
      return typeof value.roomId === "string" && value.roomId.length <= 80
        ? { type: value.type, roomId: value.roomId }
        : null;
    case "offer":
    case "answer":
      return typeof value.roomId === "string" && typeof value.sdp === "string" && value.sdp.length <= 60_000
        ? { type: value.type, roomId: value.roomId, sdp: value.sdp }
        : null;
    case "ice-candidate":
      return typeof value.roomId === "string" && isIceCandidate(value.candidate)
        ? { type: value.type, roomId: value.roomId, candidate: value.candidate }
        : null;
    case "audio-state":
      return typeof value.roomId === "string" && typeof value.enabled === "boolean"
        ? { type: value.type, roomId: value.roomId, enabled: value.enabled }
        : null;
    case "video-role-state": {
      if (typeof value.roomId !== "string" || !isRecord(value.roles)) return null;
      const { face, document } = value.roles;
      if ((typeof face !== "string" && face !== null) || (typeof document !== "string" && document !== null)) return null;
      return { type: value.type, roomId: value.roomId, roles: { face, document } };
    }
    default:
      return null;
  }
}
