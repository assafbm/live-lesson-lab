import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

type RemoteVideoViewProps = {
  label: string;
  stream: MediaStream | null;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  rotation?: 0 | 90 | 180 | 270;
  mirrored?: boolean;
  zoom?: number;
  onRotationChange?: (rotation: 0 | 90 | 180 | 270) => void;
  onMirroredChange?: (mirrored: boolean) => void;
};

/** Displays a received role stream. The parent owns the stream and its track. */
export function RemoteVideoView({
  label,
  stream,
  placeholder = "Waiting for the teacher to share this view.",
  className = "",
  style,
  rotation = 0,
  mirrored = false,
  zoom = 1,
  onRotationChange,
  onMirroredChange
}: RemoteVideoViewProps) {
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

  return (
    <section className={`remote-video-card ${className}`} aria-label={label} style={style}>
      <div className="remote-video-heading">
        <span className="camera-role-label">{label}</span>
        {stream && <span className="live-badge"><span /> LIVE</span>}
      </div>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          style={{ transform: `rotate(${rotation}deg) scale(${(quarterTurn ? 0.62 : 1) * zoom}) scaleX(${mirrored ? -1 : 1})` }}
        />
      ) : (
        <div className="remote-video-placeholder">{placeholder}</div>
      )}
      {(onRotationChange || onMirroredChange) && (
        <div className="remote-video-tools">
          {onRotationChange && (
            <label>
              Rotate
              <select value={rotation} onChange={(event) => onRotationChange(Number(event.target.value) as 0 | 90 | 180 | 270)}>
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
          )}
          {onMirroredChange && (
            <label className="mirror-toggle">
              <input type="checkbox" checked={mirrored} onChange={(event) => onMirroredChange(event.target.checked)} />
              Mirror
            </label>
          )}
        </div>
      )}
    </section>
  );
}
