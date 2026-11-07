import { recordingApi } from "./api";
export type RecordingView = { video: HTMLVideoElement | null; rotation?: number; mirrored?: boolean; zoom?: number; name: string };
export type RecordingSources = { document: RecordingView; teacher: RecordingView; student: RecordingView; audio: MediaStreamTrack[] };
const PART_BYTES = 8 * 1024 * 1024;

/** Composes only lesson pixels; it never captures the desktop or app controls.
 * Owns generated media only. Stopping it must not stop anyone's camera/mic. */
export class LessonRecorder {
  static supported() { return typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") && typeof AudioContext !== "undefined"; }
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly audio = new AudioContext();
  private readonly destination = this.audio.createMediaStreamDestination();
  private readonly compressor = this.audio.createDynamicsCompressor();
  private readonly inputs = new Map<string, MediaStreamAudioSourceNode>();
  private output: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private timer = 0;
  private chunks: Blob[] = [];
  private buffered = 0;
  private queued = 0;
  private part = 0;
  private total = 0;
  private failed: Error | null = null;
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private finishPromise: Promise<void> | null = null;
  private stopped: Promise<void> = Promise.resolve();
  constructor(private readonly id: string, private readonly sources: () => RecordingSources, private readonly onError: (message: string) => void,
    private readonly api = recordingApi) {
    this.canvas.width = 1280; this.canvas.height = 720;
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Recording canvas unavailable.");
    this.context = context;
    // Resume from the student's explicit Start click, before awaiting the API.
    void this.audio.resume();
    this.compressor.connect(this.destination);
  }
  async start() {
    try {
      if (!LessonRecorder.supported()) throw new Error("This browser cannot record this lesson. Use desktop Chrome or Edge.");
      await this.api({ action: "start", id: this.id });
      if (this.closing) throw new Error("Recording cancelled before capture started.");
      this.draw();
      this.output = new MediaStream([...this.canvas.captureStream(15).getVideoTracks(), ...this.destination.stream.getAudioTracks()]);
      this.recorder = new MediaRecorder(this.output, { mimeType: "video/webm;codecs=vp8,opus", videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
      this.stopped = new Promise(resolve => this.recorder!.addEventListener("stop", () => resolve(), { once: true }));
      this.recorder.addEventListener("dataavailable", event => {
        if (!event.data.size || this.failed) return;
        this.chunks.push(event.data); this.buffered += event.data.size;
        if (this.buffered + this.queued > 64 * 1024 * 1024) { this.fail(new Error("Upload is too slow. Recording stopped to protect browser memory.")); return; }
        this.flush(false);
      });
      this.recorder.addEventListener("error", () => this.fail(new Error("The browser stopped recording unexpectedly.")));
      this.recorder.start(1000);
      this.timer = window.setInterval(() => this.draw(), 1000 / 15);
    } catch (error) { this.dispose(); throw error; }
  }
  private drawView(view: RecordingView, x: number, y: number, width: number, height: number, cover: boolean) {
    const ctx = this.context; const video = view.video;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
    ctx.fillStyle = "#182841"; ctx.fillRect(x, y, width, height);
    if (video && video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const quarter = (view.rotation ?? 0) % 180 !== 0;
      const w = video.videoWidth, h = video.videoHeight;
      const scale = (cover ? Math.max : Math.min)(width / (quarter ? h : w), height / (quarter ? w : h)) * (view.zoom ?? 1);
      ctx.translate(x + width / 2, y + height / 2); ctx.rotate((view.rotation ?? 0) * Math.PI / 180);
      ctx.scale(view.mirrored ? -scale : scale, scale); ctx.drawImage(video, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    if (view.name) { ctx.fillStyle = "#0b1221dd"; ctx.fillRect(x, y + height - 30, width, 30); ctx.fillStyle = "white"; ctx.font = "16px sans-serif"; ctx.fillText(view.name, x + 10, y + height - 9, width - 20); }
  }
  private draw() {
    const source = this.sources();
    this.context.fillStyle = "#0b1221"; this.context.fillRect(0, 0, 1280, 720);
    this.drawView(source.document, 0, 0, 952, 720, false);
    this.drawView(source.teacher, 960, 0, 320, 320, true);
    this.drawView(source.student, 960, 328, 320, 320, true);
    // Refresh the mix when a participant unmutes or changes microphone.
    // Deduplication prevents one physical audio track being recorded twice.
    const tracks = new Map(source.audio.filter(track => track.readyState === "live" && track.enabled).map(track => [track.id, track]));
    for (const [id, node] of this.inputs) if (!tracks.has(id)) { node.disconnect(); this.inputs.delete(id); }
    for (const [id, track] of tracks) if (!this.inputs.has(id)) {
      const node = this.audio.createMediaStreamSource(new MediaStream([track])); node.connect(this.compressor); this.inputs.set(id, node);
    }
  }
  private fail(error: Error) { if (this.failed) return; this.failed = error; this.onError(error.message); void this.finish().catch(() => undefined); }
  private flush(final: boolean) {
    while (this.buffered >= PART_BYTES || (final && this.buffered > 0)) {
      const all = new Blob(this.chunks); const size = Math.min(PART_BYTES, all.size);
      const blob = all.slice(0, size); this.chunks = all.size > size ? [all.slice(size)] : []; this.buffered -= size;
      const part = ++this.part; this.queued += size; this.total += size;
      if (part > 256) { this.fail(new Error("The two-gigabyte recording limit was reached.")); return; }
      this.queue = this.queue.then(async () => {
        if (this.failed) return;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { url } = await this.api({ action: "part", id: this.id, part, bytes: blob.size });
            const response = await fetch(url!, { method: "PUT", body: blob, signal: AbortSignal.timeout(60000) });
            if (!response.ok) throw new Error("Recording upload failed.");
            break;
          } catch (error) { if (attempt === 2) throw error; }
        }
      }).catch(error => this.fail(error instanceof Error ? error : new Error("Upload failed."))).finally(() => { this.queued -= size; });
    }
  }
  finish() {
    this.closing = true;
    return this.finishPromise ??= (async () => {
      window.clearInterval(this.timer);
      if (this.recorder?.state === "recording") { this.recorder.stop(); await this.stopped; }
      this.flush(true); await this.queue;
      try {
        if (this.failed) throw this.failed;
        if (!this.total) throw new Error("No recording data was produced.");
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await this.api({ action: "complete", id: this.id }); break; }
          catch (error) { if (attempt === 2) throw error; }
        }
      } catch (error) {
        await this.api({ action: "abort", id: this.id }).catch(() => undefined);
        throw error;
      } finally { this.dispose(); }
    })();
  }
  dispose() {
    window.clearInterval(this.timer);
    this.inputs.forEach(node => node.disconnect()); this.inputs.clear();
    this.output?.getTracks().forEach(track => track.stop());
    this.destination.stream.getTracks().forEach(track => track.stop());
    void this.audio.close().catch(() => undefined);
  }
}
