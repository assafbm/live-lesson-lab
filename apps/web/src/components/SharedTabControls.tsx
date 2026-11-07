import { useEffect, useRef, useState, type RefObject } from "react";
import type { CapturedTabController } from "../media/CapturedTabController";

export function SharedTabControls({ controller, preview }: { controller: CapturedTabController | null; preview: RefObject<HTMLVideoElement | null> }) {
  const [scrolling, setScrolling] = useState(false);
  const [pending, setPending] = useState(false);
  const [zoom, setZoom] = useState(controller?.zoomLevel ?? 100);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const enabled = useRef(false);
  useEffect(() => {
    alive.current = true;
    const update = () => setZoom(controller?.zoomLevel ?? 100);
    controller?.addEventListener("zoomlevelchange", update);
    return () => {
      alive.current = false;
      controller?.removeEventListener("zoomlevelchange", update);
      if (enabled.current) void controller?.forwardWheel(null).catch(() => undefined);
    };
  }, [controller]);
  if (!controller) return <div className="shared-tab-controls"><span title="Share a browser tab in a browser supporting tab controls. Windows and presentations are controlled in their original app.">Control this share in its original tab or app</span></div>;
  let levels: number[] = [];
  try { levels = controller.getSupportedZoomLevels(); } catch { /* Surface might have changed or ended. */ }
  async function control(action: "scroll" | "in" | "out" | "reset") {
    if (!controller || pending) return;
    setPending(true); setError("");
    try {
      // These calls deliberately occur directly within a click, before any
      // unrelated await, so the browser can request its own control permission.
      if (action === "scroll") {
        const next = !enabled.current;
        if (next && !preview.current) throw new Error("Preview unavailable");
        await controller.forwardWheel(next ? preview.current : null);
        if (!alive.current) { await controller.forwardWheel(null); return; }
        enabled.current = next; setScrolling(next);
      } else {
        await (action === "in" ? controller.increaseZoomLevel() : action === "out" ? controller.decreaseZoomLevel() : controller.resetZoomLevel());
        if (alive.current) setZoom(controller.zoomLevel ?? 100);
      }
    } catch {
      if (alive.current) setError("Tab control was denied or is unavailable. You can still use the original tab.");
    } finally { if (alive.current) setPending(false); }
  }
  return <div className="shared-tab-controls" aria-label="Shared tab controls">
    <button type="button" disabled={pending} aria-pressed={scrolling} onClick={() => void control("scroll")}>{scrolling ? "Stop tab scrolling" : "Enable tab scrolling"}</button>
    <button type="button" disabled={pending || !levels.length || zoom <= levels[0]} aria-label="Zoom shared tab out" title="Zoom shared tab out" onClick={() => void control("out")}>−</button>
    <button type="button" disabled={pending} aria-label="Reset shared tab zoom" title="Reset shared tab zoom" onClick={() => void control("reset")}>{zoom}%</button>
    <button type="button" disabled={pending || !levels.length || zoom >= levels[levels.length - 1]} aria-label="Zoom shared tab in" title="Zoom shared tab in" onClick={() => void control("in")}>+</button>
    {scrolling && <span>Scroll over the preview</span>}
    {error && <span role="status">{error}</span>}
  </div>;
}
