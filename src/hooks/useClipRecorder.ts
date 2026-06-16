import { useCallback, useEffect, useRef } from "react";

/**
 * Keeps a rolling buffer of recent video so a short clip can be saved around a
 * flagged event.
 *
 * Implementation note: earlier versions restarted the `MediaRecorder` every
 * `clipSeconds` (and again on every `saveClip()`) to produce self-contained
 * WebM segments. On mobile that re-initialises the hardware video encoder,
 * which briefly stalls the camera pipeline — visible as a flash/freeze, and
 * the detection loop (which reads frames from the same pipeline) stalls with
 * it, dropping vehicles during the gap.
 *
 * Instead we run ONE recorder with a `timeslice`, so `ondataavailable` fires
 * periodically without ever stopping it. `saveClip()` calls `requestData()`
 * to flush immediately (no stop/restart) and returns everything buffered
 * since the last (infrequent, fixed-cadence) restart. Restarts only happen
 * on a long fixed interval purely to bound memory over a 24h run.
 */
const SEGMENT_MS = 30_000;
const TIMESLICE_MS = 1000;

export function useClipRecorder(
  stream: MediaStream | null,
  clipSeconds: number,
  enabled: boolean
) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const cycleRef = useRef<number | null>(null);
  const mimeRef = useRef<string>("video/webm");
  // Kept for API stability / potential future use; cadence is intentionally
  // decoupled from this so restarts stay rare regardless of the setting.
  void clipSeconds;

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
      const prev = recorderRef.current;
      if (prev && prev.state !== "inactive") {
        try {
          prev.stop();
        } catch {
          /* ignore */
        }
      }
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      // Timeslice lets saveClip() flush via requestData() without stopping.
      rec.start(TIMESLICE_MS);
      recorderRef.current = rec;
    };

    startSegment();
    // Infrequent, fixed-cadence restart — only to bound memory growth over a
    // long run. This is the only operation that can hitch the camera, so it
    // is deliberately rare (and independent of the configured clip length).
    cycleRef.current = window.setInterval(startSegment, SEGMENT_MS);

    return cleanup;
  }, [stream, enabled, cleanup]);

  /** Return the footage buffered since the last segment restart (≤ ~30s). */
  const saveClip = useCallback(async (): Promise<Blob | null> => {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return null;
    await new Promise<void>((resolve) => {
      const onData = () => {
        r.removeEventListener("dataavailable", onData);
        resolve();
      };
      r.addEventListener("dataavailable", onData, { once: true });
      try {
        r.requestData();
      } catch {
        resolve();
      }
    });
    if (!chunksRef.current.length) return null;
    return new Blob(chunksRef.current, { type: mimeRef.current });
  }, []);

  return { saveClip };
}
