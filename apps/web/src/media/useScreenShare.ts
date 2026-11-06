import { useCallback, useEffect, useRef, useState } from "react";

/** Owns display capture separately from physical-camera leases. A browser
 * picker is a user action, so start() calls getDisplayMedia before any await. */
export function useScreenShare() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    generation.current += 1;
    requesting.current = false;
    current.current?.getTracks().forEach((track) => track.stop());
    current.current = null;
    if (mounted.current) { setStream(null); setPending(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);

  const fail = useCallback((message: string) => {
    stop();
    if (mounted.current) setError(message);
  }, [stop]);

  const start = useCallback(async () => {
    if (requesting.current || current.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser. You can still use a document camera.");
      return;
    }
    requesting.current = true;
    const request = ++generation.current;
    setPending(true);
    setError("");
    try {
      const capture = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } }, audio: false
      });
      // The picker cannot be cancelled by the app. Disconnect invalidates the
      // request; a late result must be stopped without appearing in the lesson.
      if (!mounted.current || generation.current !== request) {
        capture.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = capture.getVideoTracks()[0];
      if (!track || track.readyState !== "live") {
        capture.getTracks().forEach((item) => item.stop());
        throw new Error("The selected screen is no longer available.");
      }
      track.contentHint = "detail";
      track.addEventListener("ended", () => {
        if (current.current === capture) stop();
      }, { once: true });
      current.current = capture;
      setStream(capture);
    } catch (cause) {
      if (!mounted.current || generation.current !== request) return;
      // Cancelling the browser picker preserves the previous camera choice.
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Screen sharing was cancelled or denied. Your document camera selection is unchanged."
        : "The screen could not be shared. Try another window or use a document camera.");
    } finally {
      if (mounted.current && generation.current === request) {
        requesting.current = false;
        setPending(false);
      }
    }
  }, [stop]);

  return { stream, pending, error, start, stop, fail };
}
