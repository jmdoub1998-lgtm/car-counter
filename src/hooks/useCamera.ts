import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "starting" | "running" | "error";

export interface UseCamera {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  error: string | null;
  /** The live MediaStream (null when using a dev video file). */
  stream: MediaStream | null;
  startCamera: () => Promise<void>;
  /** Dev/testing: play a recorded clip through the same <video> element. */
  useFile: (file: File) => void;
  stop: () => void;
}

/**
 * Manages the camera (rear-facing by default) feeding a single <video> element.
 * Also supports loading a local video file so the detection→counting pipeline can
 * be validated deterministically without live traffic.
 */
export function useCamera(): UseCamera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
      v.removeAttribute("src");
      v.load();
    }
    setStatus("idle");
  }, []);

  const startCamera = useCallback(async () => {
    setStatus("starting");
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = media;
      setStream(media);
      const v = videoRef.current;
      if (v) {
        v.srcObject = media;
        v.muted = true;
        v.playsInline = true;
        await v.play();
      }
      setStatus("running");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not access the camera."
      );
      setStatus("error");
    }
  }, []);

  const useFile = useCallback((file: File) => {
    setError(null);
    setStatus("starting");
    // A file source replaces any live stream.
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    const v = videoRef.current;
    if (v) {
      v.srcObject = null;
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.play().then(
        () => setStatus("running"),
        (e) => {
          setError(e instanceof Error ? e.message : "Could not play file.");
          setStatus("error");
        }
      );
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { videoRef, status, error, stream, startCamera, useFile, stop };
}
