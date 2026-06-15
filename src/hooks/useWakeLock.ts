import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hold a screen Wake Lock so a phone used as a counting kiosk does not dim/lock
 * mid-run. The lock is released by the OS when the tab is hidden, so we re-acquire
 * it whenever the page becomes visible again.
 */
export function useWakeLock(active: boolean) {
  const lockRef = useRef<WakeLockSentinel | null>(null);
  const [held, setHeld] = useState(false);
  const [supported] = useState(
    () => typeof navigator !== "undefined" && "wakeLock" in navigator
  );

  const acquire = useCallback(async () => {
    if (!supported || !active) return;
    try {
      lockRef.current = await navigator.wakeLock.request("screen");
      setHeld(true);
      lockRef.current.addEventListener("release", () => setHeld(false));
    } catch {
      setHeld(false);
    }
  }, [supported, active]);

  useEffect(() => {
    if (!active) {
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
      setHeld(false);
      return;
    }
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active, acquire]);

  return { supported, held };
}
