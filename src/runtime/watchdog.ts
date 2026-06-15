import { useEffect, useRef, useState } from "react";

/**
 * Watches the processing rate during a run. If detection stops producing frames
 * for `stallMs` while the session is supposed to be running (tab throttled, camera
 * dropped, GPU context lost), it flags a stall and invokes `onStall` so the caller
 * can attempt to restart the camera/inference. Essential for unattended 24h runs.
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
  onStallRef.current = onStall;

  // Any positive FPS counts as healthy.
  useEffect(() => {
    if (fps > 0) {
      lastHealthyRef.current = Date.now();
      if (stalled) setStalled(false);
    }
  }, [fps, stalled]);

  useEffect(() => {
    if (!running) {
      setStalled(false);
      lastHealthyRef.current = Date.now();
      return;
    }
    const id = window.setInterval(() => {
      if (Date.now() - lastHealthyRef.current > stallMs) {
        if (!stalled) {
          setStalled(true);
          onStallRef.current();
        }
        // Give the recovery a grace period before firing again.
        lastHealthyRef.current = Date.now();
      }
    }, 2000);
    return () => clearInterval(id);
  }, [running, stallMs, stalled]);

  return stalled;
}
