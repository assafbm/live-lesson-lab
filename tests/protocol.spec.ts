import { test, expect } from "@playwright/test";
import { parseClientMessage, MAX_SIGNALING_BYTES } from "../packages/shared/src/index";
import { summarizeMediaQuality } from "../apps/web/src/media/MediaQuality";

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
