// This browser capability is not available everywhere or in every DOM typings
// version. Keep the optional interface narrow and feature-detect at runtime.
export interface CapturedTabController extends EventTarget {
  forwardWheel(element: HTMLElement | null): Promise<void>;
  increaseZoomLevel(): Promise<void>;
  decreaseZoomLevel(): Promise<void>;
  resetZoomLevel(): Promise<void>;
  getSupportedZoomLevels(): number[];
  zoomLevel: number | null;
}
