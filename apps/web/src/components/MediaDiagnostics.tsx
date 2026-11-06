import type { MediaQualitySample } from "../media/MediaQuality";

export function MediaDiagnostics({ samples }: { samples: MediaQualitySample[] }) {
  const latest = samples.at(-1);
  const display = (value: number | null, unit: string) => value === null ? "Not available" : `${value} ${unit}`;
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, samples }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "live-lesson-lab-media-quality.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="media-diagnostics">
    <summary>Connection diagnostics</summary>
    <p>Updates every five seconds. Speak continuously for 20 seconds when investigating sound. These measurements do not establish how natural speech sounds.</p>
    {!latest && <p>Measurements appear once the media connection is established.</p>}
    {latest?.audio.map((audio, index) => <div className="diagnostic-card" key={`${audio.direction}-${index}`}>
      <strong>{audio.direction} audio · {audio.codec ?? "Codec pending"}</strong>
      <dl>
        <dt>Packet flow</dt><dd>{display(audio.packetsPerSecond, "packets/s")}</dd>
        <dt>Audio level</dt><dd>{display(audio.level, "(0–1)")}</dd>
        <dt>Bitrate</dt><dd>{display(audio.kilobitsPerSecond, "kbps")}</dd>
        {audio.direction === "Receiving" && <>
          <dt>Lost packets</dt><dd>{display(audio.lostPackets, "in interval")}</dd>
          <dt>Jitter</dt><dd>{display(audio.jitterMs, "ms")}</dd>
          <dt>Concealed samples</dt><dd>{display(audio.concealedPercent, "%")}</dd>
          <dt>Buffer delay</dt><dd>{display(audio.bufferDelayMs, "ms")}</dd>
        </>}
      </dl>
    </div>)}
    {latest?.video.map((video, index) => <p key={index}>{video.direction} video: {video.width ?? "?"} × {video.height ?? "?"}, {display(video.fps, "fps")}, {display(video.kilobitsPerSecond, "kbps")}{video.limitation ? ` · Limitation: ${video.limitation}` : ""}</p>)}
    <button type="button" className="meeting-permission-button" onClick={download} disabled={!latest}>Download last minute</button>
    <p>The download contains media counters only. It excludes device names, network addresses, room links, and recordings.</p>
  </details>;
}
