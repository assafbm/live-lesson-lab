/** A deliberately small diagnostic export: no SDP, candidates, IPs, device IDs,
 * room IDs, or audio recordings. Counter differences describe one interval. */
export type MediaQualitySample = {
  sampledAt: string;
  audio: { direction: string; packetsPerSecond: number | null; kilobitsPerSecond: number | null;
    level: number | null; lostPackets: number | null; jitterMs: number | null;
    concealedPercent: number | null; bufferDelayMs: number | null; codec: string | null }[];
  video: { direction: string; width: number | null; height: number | null; fps: number | null;
    kilobitsPerSecond: number | null; limitation: string | null }[];
};

type StatsRow = { id: string; type: string; timestamp: number; [key: string]: unknown };
export type PreviousMediaStats = Map<string, StatsRow>;
const number = (row: StatsRow | undefined, key: string): number | null =>
  typeof row?.[key] === "number" ? row[key] as number : null;
const rounded = (value: number | null) => value === null ? null : Math.round(value * 100) / 100;

export function summarizeMediaQuality(report: RTCStatsReport, previous: PreviousMediaStats): MediaQualitySample {
  const sample: MediaQualitySample = { sampledAt: new Date().toISOString(), audio: [], video: [] };
  for (const entry of report.values()) {
    const row = entry as StatsRow;
    if (row.type !== "inbound-rtp" && row.type !== "outbound-rtp") continue;
    const before = previous.get(row.id);
    const elapsed = before ? (row.timestamp - before.timestamp) / 1000 : 0;
    const delta = (key: string) => {
      const now = number(row, key);
      const then = number(before, key);
      // A missing value or reset counter is unknown, never a fabricated zero.
      return now !== null && then !== null && now >= then ? now - then : null;
    };
    const rate = (key: string, multiplier = 1) => {
      const difference = delta(key);
      return difference !== null && elapsed > 0 ? rounded(difference * multiplier / elapsed) : null;
    };
    const incoming = row.type === "inbound-rtp";
    const direction = incoming ? "Receiving" : "Sending";
    const kilobitsPerSecond = rate(incoming ? "bytesReceived" : "bytesSent", 8 / 1000);
    if (row.kind === "audio") {
      const totalSamples = delta("totalSamplesReceived");
      const concealedSamples = delta("concealedSamples");
      const emitted = delta("jitterBufferEmittedCount");
      const delay = delta("jitterBufferDelay");
      const source = typeof row.mediaSourceId === "string" ? report.get(row.mediaSourceId) as StatsRow | undefined : undefined;
      const codec = typeof row.codecId === "string" ? report.get(row.codecId) as StatsRow | undefined : undefined;
      sample.audio.push({ direction, packetsPerSecond: rate(incoming ? "packetsReceived" : "packetsSent"), kilobitsPerSecond,
        level: rounded(number(incoming ? row : source, "audioLevel")),
        lostPackets: delta("packetsLost"), jitterMs: rounded(number(row, "jitter") === null ? null : Number(row.jitter) * 1000),
        concealedPercent: rounded(totalSamples && concealedSamples !== null ? 100 * concealedSamples / totalSamples : null),
        bufferDelayMs: rounded(emitted && delay !== null ? 1000 * delay / emitted : null),
        codec: typeof codec?.mimeType === "string" ? codec.mimeType : null });
    } else if (row.kind === "video") {
      sample.video.push({ direction, kilobitsPerSecond, width: number(row, "frameWidth"), height: number(row, "frameHeight"),
        fps: number(row, "framesPerSecond"), limitation: typeof row.qualityLimitationReason === "string" ? row.qualityLimitationReason : null });
    }
    previous.set(row.id, row);
  }
  return sample;
}
