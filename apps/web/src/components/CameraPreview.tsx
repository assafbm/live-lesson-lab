import { useEffect, useRef } from "react";

type CameraPreviewProps = {
  label: string;
  stream: MediaStream | null;
  message: string;
  active: boolean;
  mirrored?: boolean;
};

export function CameraPreview({ label, stream, message, active, mirrored = false }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    // A video element displays a stream through srcObject. The source manager,
    // rather than this view component, owns and stops the underlying tracks.
    if (videoRef.current) videoRef.current.srcObject = stream;
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={`preview-frame ${active ? "preview-active" : ""}`}>
      <video
        ref={videoRef}
        className={mirrored ? "preview-video preview-mirrored" : "preview-video"}
        aria-label={`${label} preview`}
        autoPlay
        playsInline
        muted
        hidden={!active}
      />
      {!active && <div className="preview-placeholder">{message}</div>}
      {active && <span className="preview-live"><span /> LIVE PREVIEW</span>}
    </div>
  );
}
