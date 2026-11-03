export type VideoTransform = {
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
};

/**
 * Draws camera frames into a canvas before captureStream exposes them to WebRTC.
 * The peer therefore receives the changed pixels, not a CSS preference or
 * transform metadata that it would need to understand separately.
 */
export class OutgoingVideoTransform {
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;

  private readonly video = document.createElement("video");
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private frameRequest = 0;
  private transform: VideoTransform;
  private stopped = false;

  constructor(sourceTrack: MediaStreamTrack, transform: VideoTransform) {
    const context = this.canvas.getContext("2d", { alpha: false });
    if (!context || typeof this.canvas.captureStream !== "function") {
      throw new Error("This browser cannot prepare transformed video for sharing.");
    }
    this.context = context;
    this.transform = transform;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = new MediaStream([sourceTrack]);
    this.stream = this.canvas.captureStream(30);
    const outputTrack = this.stream.getVideoTracks()[0];
    if (!outputTrack) throw new Error("The transformed camera did not create a video track.");
    this.track = outputTrack;
    void this.video.play().catch(() => undefined);
    this.drawFrame();
  }

  update(transform: VideoTransform) {
    this.transform = transform;
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.frameRequest);
    this.video.pause();
    this.video.srcObject = null;
    this.stream.getTracks().forEach((track) => track.stop());
  }

  private drawFrame = () => {
    if (this.stopped) return;
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width > 0 && height > 0) {
      const quarterTurn = this.transform.rotation === 90 || this.transform.rotation === 270;
      const outputWidth = quarterTurn ? height : width;
      const outputHeight = quarterTurn ? width : height;
      if (this.canvas.width !== outputWidth || this.canvas.height !== outputHeight) {
        this.canvas.width = outputWidth;
        this.canvas.height = outputHeight;
      }

      const context = this.context;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, outputWidth, outputHeight);
      context.translate(outputWidth / 2, outputHeight / 2);
      context.rotate((this.transform.rotation * Math.PI) / 180);
      context.scale(this.transform.mirrored ? -1 : 1, 1);
      context.drawImage(this.video, -width / 2, -height / 2, width, height);
    }
    this.frameRequest = requestAnimationFrame(this.drawFrame);
  };
}
