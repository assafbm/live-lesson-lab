import { useEffect, useRef } from "react";

type MeetingVideoTileProps = {
  label: string;
  stream: MediaStream | null;
  local?: boolean;
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
  stream,
  local = false,
  main = false,
  placeholder,
  detail,
  rotation = 0,
  mirrored = false,
  zoom = 1
}: MeetingVideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const quarterTurn = rotation === 90 || rotation === 270;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // A quarter turn swaps the frame's visual width and height. Scaling those
  // turns down keeps the complete image inside its tile instead of cropping it.
  return (
    <section className={`meeting-video-tile ${main ? "meeting-main-tile" : ""}`} aria-label={label}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={local}
          style={{ transform: `rotate(${rotation}deg) scale(${(quarterTurn ? 0.62 : 1) * zoom}) scaleX(${mirrored ? -1 : 1})` }}
        />
      ) : (
        <div className="meeting-video-placeholder">{placeholder}</div>
      )}
      <div className="meeting-tile-label">
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </div>
      {stream && <span className="meeting-live-dot" aria-label="Video active" />}
    </section>
  );
}
