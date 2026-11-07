import { test, expect } from "@playwright/test";
import { isInvitationOpen, parseClientMessage, MAX_SIGNALING_BYTES } from "../packages/shared/src/index";
import { summarizeMediaQuality } from "../apps/web/src/media/MediaQuality";

test("participant names are bounded, trimmed and cannot smuggle control characters", () => {
  expect(parseClientMessage(JSON.stringify({ type: "participant-name", roomId: "room", name: "  Noa  " })))
    .toEqual({ type: "participant-name", roomId: "room", name: "Noa" });
  for (const name of [" ", "x".repeat(61), "bad\nname"]) {
    expect(parseClientMessage(JSON.stringify({ type: "participant-name", roomId: "room", name }))).toBeNull();
  }
});

test("rejects malformed, oversized, empty-room and invalid ICE payloads", () => {
  for (const payload of ["{", "null", "[]", "x".repeat(MAX_SIGNALING_BYTES + 1),
    JSON.stringify({ type: "join-room", roomId: "" }),
    JSON.stringify({ type: "offer", roomId: "../room", sdp: "x" }),
    JSON.stringify({ type: "offer", roomId: "room", sdp: "界".repeat(12_000) }),
    JSON.stringify({ type: "ice-candidate", roomId: "room", candidate: { candidate: "x", sdpMid: "0", sdpMLineIndex: -1 } })
  ]) expect(parseClientMessage(payload)).toBeNull();
});

test("strips unrecognized fields and preserves valid shared role mapping", () => {
  expect(parseClientMessage(JSON.stringify({ type: "ice-candidate", roomId: "room", candidate: {
    candidate: "candidate:example", sdpMid: "0", sdpMLineIndex: 0, privateExtra: "must not be relayed"
  } }))).toEqual({ type: "ice-candidate", roomId: "room", candidate: { candidate: "candidate:example", sdpMid: "0", sdpMLineIndex: 0 } });
  expect(parseClientMessage(JSON.stringify({ type: "video-role-state", roomId: "room", roles: { face: "1", document: "1" } })))
    .toEqual({ type: "video-role-state", roomId: "room", roles: { face: "1", document: "1" } });
});

test("quality diagnostics use interval deltas and never export addresses", () => {
  const previous = new Map();
  const report = (timestamp: number, packets: number, samples: number, concealed: number) => new Map([
    ["audio", { id: "audio", type: "inbound-rtp", kind: "audio", timestamp, packetsReceived: packets, totalSamplesReceived: samples, concealedSamples: concealed, bytesReceived: packets * 100, jitter: 0.002, ip: "private" }]
  ]) as unknown as RTCStatsReport;
  expect(summarizeMediaQuality(report(1000, 100, 1000, 100), previous).audio[0].packetsPerSecond).toBeNull();
  const result = summarizeMediaQuality(report(6000, 350, 241000, 12100), previous);
  expect(result.audio[0]).toMatchObject({ packetsPerSecond: 50, concealedPercent: 5, jitterMs: 2 });
  expect(JSON.stringify(result)).not.toContain("private");
  expect(summarizeMediaQuality(report(7000, 1, 1, 0), previous).audio[0].packetsPerSecond).toBeNull();
});

test("invitation admission fails closed at expiry and validates control payloads", async () => {
  expect(isInvitationOpen({ locked: false, joinExpiresAt: 100 }, 99)).toBe(true);
  expect(isInvitationOpen({ locked: false, joinExpiresAt: 100 }, 100)).toBe(false);
  expect(isInvitationOpen({ locked: true, joinExpiresAt: 100 }, 99)).toBe(false);
  expect(isInvitationOpen({}, 99)).toBe(false);
  expect(parseClientMessage(JSON.stringify({ type: "set-room-locked", roomId: "room", locked: "false" }))).toBeNull();
});
