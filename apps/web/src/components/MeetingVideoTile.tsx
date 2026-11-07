import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type MeetingVideoTileProps = {
  label: string;
  accessibleLabel?: string;
  previewRef?: RefObject<HTMLVideoElement | null>;
  children?: ReactNode;
  stream: MediaStream | null;
  main?: boolean;
  placeholder: string;
  detail?: string;
  rotation?: 0 | 90 | 180 | 270;
  mirrored?: boolean;
  zoom?: number;
};

/** A contained video tile. The peer-session hook, not this view, owns tracks. */
export function MeetingVideoTile({
  label,
  accessibleLabel,
  previewRef,
  children,
  stream,
  main = false,
  placeholder,
  detail,
  rotation = 0,
  mirrored = false,
  zoom = 1
}: MeetingVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const tile = tileRef.current;
    const video = videoRef.current;
    if (!tile || !video) return;
    const fit = () => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;
      const quarterTurn = rotation === 90 || rotation === 270;
      const scale = Math.min(tile.clientWidth / (quarterTurn ? height : width), tile.clientHeight / (quarterTurn ? width : height));
      setFrameSize({ width: width * scale, height: height * scale });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(tile);
    video.addEventListener("resize", fit);
    video.addEventListener("loadedmetadata", fit);
    fit();
    return () => { observer.disconnect(); video.removeEventListener("resize", fit); video.removeEventListener("loadedmetadata", fit); };
  }, [stream, rotation]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Fit the actual rotated dimensions. A fixed scale clips portrait documents
  // on short screens and wastes space on wide screens.
  return (
    <section ref={tileRef} className={`meeting-video-tile ${main ? "meeting-main-tile" : ""}`} aria-label={accessibleLabel ?? label}>
      {stream ? (
        <video
          ref={(element) => { videoRef.current = element; if (previewRef) previewRef.current = element; }}
          autoPlay
          playsInline
          muted
          style={{ ...frameSize, transform: `rotate(${rotation}deg) scale(${zoom}) scaleX(${mirrored ? -1 : 1})` }}
        />
      ) : (
        <div className="meeting-video-placeholder">{placeholder}</div>
      )}
      {!main && <div className="meeting-tile-label">
        <span>{label}</span>
        {detail && <small aria-label={detail} title={detail}>{detail === "Microphone muted" ? "⊘" : ""}</small>}
      </div>}
      {stream && <span className="meeting-live-dot" aria-label="Video active" />}
      {children}
    </section>
  );
}
