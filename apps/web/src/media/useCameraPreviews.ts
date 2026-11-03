import { useEffect, useState } from "react";
import { cameraSourceManager } from "./CameraSourceManager";

type RoleSelection = {
  face: string | null;
  document: string | null;
};

type CameraPreviewState = {
  stream: MediaStream;
  error?: string;
};

type PreviewMap = Record<string, CameraPreviewState>;

function describeCaptureError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission was denied. Check your browser's site permissions.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "This camera is no longer available. Choose another source.";
  }
  if (error instanceof DOMException && error.name === "NotReadableError") {
    return "The camera could not be read. It may be in use by another app.";
  }
  return "Could not start this camera. Try selecting it again or choose another source.";
}

/** Acquires each unique selected device once and exposes its stream by device ID. */
export function useCameraPreviews(selection: RoleSelection) {
  const [sources, setSources] = useState<PreviewMap>({});
  const faceDeviceId = selection.face;
  const documentDeviceId = selection.document;

  useEffect(() => {
    let active = true;
    const endedHandlers: Array<{ track: MediaStreamTrack; listener: () => void }> = [];
    const uniqueDeviceIds = [...new Set([faceDeviceId, documentDeviceId].filter((id): id is string => Boolean(id)))];
    const leases = uniqueDeviceIds.map((deviceId) => ({
      deviceId,
      lease: cameraSourceManager.acquire(deviceId)
    }));

    // Old selections should no longer appear as the new device starts.
    setSources({});

    for (const { deviceId, lease } of leases) {
      void lease.stream.then((stream) => {
        if (!active) return;

        const handleEnded = () => {
          if (!active) return;
          setSources((current) => ({
            ...current,
            [deviceId]: { stream, error: "This camera was disconnected. Choose another source." }
          }));
        };

        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", handleEnded);
          endedHandlers.push({ track, listener: handleEnded });
        });
        setSources((current) => ({ ...current, [deviceId]: { stream } }));
      }).catch((error: unknown) => {
        if (!active) return;
        setSources((current) => ({
          ...current,
          [deviceId]: { stream: new MediaStream(), error: describeCaptureError(error) }
        }));
      });
    }

    return () => {
      active = false;
      endedHandlers.forEach(({ track, listener }) => track.removeEventListener("ended", listener));
      leases.forEach(({ lease }) => lease.release());
    };
  }, [faceDeviceId, documentDeviceId]);

  return { sources };
}
