import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a rolling buffer of recent video so a short clip can be saved around a
 * flagged event. Implementation note: a `MediaRecorder` is restarted on an
 * interval so each segment is a self-contained, playable WebM. We retain the most
 * recently completed segment; on `saveClip()` that segment (up to `clipSeconds` of
 * pre-roll around the event) is returned. This is intentionally simple and robust
 * rather than a frame-perfect pre-roll buffer.
 */
export function useClipRecorder(
  stream: MediaStream | null,
  clipSeconds: number,
  enabled: boolean
) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const lastSegmentRef = useRef<Blob | null>(null);
  const cycleRef = useRef<number | null>(null);
  const mimeRef = useRef<string>("video/webm");

  const cleanup = useCallback(() => {
    if (cycleRef.current) {
      clearInterval(cycleRef.current);
      cycleRef.current = null;
    }
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => {
    if (!enabled || !stream || stream.getVideoTracks().length === 0) {
      cleanup();
      return;
    }
    if (typeof MediaRecorder === "undefined") return;

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";
    mimeRef.current = mime;

    const startSegment = () => {
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        if (chunksRef.current.length) {
          lastSegmentRef.current = new Blob(chunksRef.current, { type: mime });
        }
      };
      rec.start();
      recorderRef.current = rec;
    };

    startSegment();
    cycleRef.current = window.setInterval(() => {
      const r = recorderRef.current;
      if (r && r.state !== "inactive") {
        r.stop(); // flushes into lastSegment via onstop
      }
      startSegment();
    }, Math.max(2, clipSeconds) * 1000);

    return cleanup;
  }, [stream, clipSeconds, enabled, cleanup]);

  /** Return the most recent self-contained segment as a clip, or null. */
  const saveClip = useCallback(async (): Promise<Blob | null> => {
    // Flush current segment so the freshest footage is available.
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      await new Promise<void>((resolve) => {
        const onStop = () => {
          r.removeEventListener("stop", onStop);
          resolve();
        };
        r.addEventListener("stop", onStop);
        r.stop();
      });
    }
    return lastSegmentRef.current;
  }, []);

  return { saveClip };
}
