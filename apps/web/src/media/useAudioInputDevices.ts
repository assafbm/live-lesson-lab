import { useCallback, useEffect, useState } from "react";

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

/**
 * Lists microphones only after a deliberate user action. Browsers hide device
 * labels until microphone permission is granted, so the temporary permission
 * stream is stopped immediately and is never attached to the lesson.
 */
export function useAudioInputDevices() {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [permissionReady, setPermissionReady] = useState(false);
  const [error, setError] = useState("");

  const refreshDevices = useCallback(async () => {
    const inputs = (await navigator.mediaDevices.enumerateDevices())
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Microphone ${index + 1}`
      }));

    setDevices(inputs);
    setSelectedDeviceId((current) => current && inputs.some((device) => device.deviceId === current) ? current : "");
    setError(inputs.length > 0 ? "" : "No microphone was found. You can still join and listen.");
  }, []);

  const requestAccess = useCallback(async (permissionAlreadyGranted = false) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone access.");
      return;
    }

    let permissionStream: MediaStream | null = null;
    try {
      // If the live microphone is already enabled, reusing its permission avoids
      // opening a second capture of the same device just to enumerate it.
      if (!permissionAlreadyGranted) {
        permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
      await refreshDevices();
      setPermissionReady(true);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        setError("Microphone access was denied. Allow microphone access in your browser, then try again.");
      } else if (cause instanceof DOMException && cause.name === "NotFoundError") {
        await refreshDevices().catch(() => undefined);
        setPermissionReady(true);
      } else {
        setError("The microphone list could not be loaded. Check that a microphone is connected.");
      }
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }, [refreshDevices]);

  useEffect(() => {
    if (!permissionReady || !navigator.mediaDevices) return;
    const handleDeviceChange = () => void refreshDevices().catch(() => setError("The microphone list could not be refreshed."));
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [permissionReady, refreshDevices]);

  return { devices, selectedDeviceId, setSelectedDeviceId, permissionReady, error, requestAccess };
}
