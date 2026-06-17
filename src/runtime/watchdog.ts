import { useEffect, useRef, useState } from "react";

/**
 * Watches the processing rate during a run. If detection stops producing frames
 * for `stallMs` while the session is supposed to be running (tab throttled, camera
 * dropped, GPU context lost), it flags a stall and invokes `onStall` so the caller
 * can attempt to restart the camera/inference. Essential for unattended 24h runs.
 *
 * Note: the health check uses a ref-backed fps (not a dep) so that a stable fps
 * value (e.g. always 12) still keeps lastHealthyRef updated. Previously the health
 * effect only fired on fps *value changes*, so a perfectly-stable fps of 12 would
 * stop updating lastHealthy after the first second, causing spurious stall triggers.
 */
export function useWatchdog(
  running: boolean,
  fps: number,
  onStall: () => void,
  stallMs = 6000
) {
  const [stalled, setStalled] = useState(false);
  const lastHealthyRef = useRef(Date.now());
  const onStallRef = useRef(onStall);
  const fpsRef = useRef(fps);
  onStallRef.current = onStall;
  fpsRef.current = fps;

  // Poll every second using a ref so a constant (non-changing) fps still keeps
  // lastHealthy fresh. This replaces the old dep-based [fps] effect that would
  // stop firing when fps stabilized at a fixed value.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (fpsRef.current > 0) {
        lastHealthyRef.current = Date.now();
        setStalled((s) => (s ? false : s)); // clear stall if recovering
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!running) {
      setStalled(false);
      lastHealthyRef.current = Date.now();
      return;
    }
    const id = window.setInterval(() => {
      if (Date.now() - lastHealthyRef.current > stallMs) {
        setStalled(true);
        onStallRef.current();
        // Reset so we don't fire again immediately.
        lastHealthyRef.current = Date.now();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [running, stallMs]);

  return stalled;
}
