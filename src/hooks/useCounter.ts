import { useEffect, useRef, useState } from "react";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { DirectionKey, LineConfig, SessionSettings, VehicleType } from "../types";
import { detectVehicles, liveTensorCount, type Detection } from "../cv/detector";
import {
  MotionDetector,
  DEFAULT_MOTION_SETTINGS,
  type MotionSettings,
} from "../cv/motionDetector";
import { Tracker, type Track } from "../cv/tracker";
import { crossDirection, lineToPixels } from "../cv/lineCrossing";
import { evaluateFlag } from "../cv/flagging";

export interface CountPayload {
  direction: DirectionKey;
  vehicleType: VehicleType;
  confidence: number;
  flagged: boolean;
  reason: string;
  snapshotUrl?: string;
}

export interface CounterStats {
  fps: number;
  tensors: number;
  trackCount: number;
  /** True while the motion detector is still building its background model. */
  warming: boolean;
}

interface UseCounterArgs {
  videoRef: React.RefObject<HTMLVideoElement>;
  overlayRef: React.RefObject<HTMLCanvasElement>;
  /** Only needed for coco-ssd mode; may be null in motion mode. */
  model: cocoSsd.ObjectDetection | null;
  enabled: boolean;
  getSettings: () => SessionSettings;
  getLine: () => LineConfig;
  onCount: (payload: CountPayload) => void;
}

export function useCounter({
  videoRef,
  overlayRef,
  model,
  enabled,
  getSettings,
  getLine,
  onCount,
}: UseCounterArgs): CounterStats {
  const [stats, setStats] = useState<CounterStats>({
    fps: 0,
    tensors: 0,
    trackCount: 0,
    warming: false,
  });
  const trackerRef = useRef(new Tracker());
  const motionRef = useRef(new MotionDetector());
  const onCountRef = useRef(onCount);
  onCountRef.current = onCount;

  useEffect(() => {
    if (!enabled) return;
    const settings = getSettings();
    if (!settings) return;
    const isMotion = settings.detectionMode === "motion";

    // In motion mode we don't need the COCO-SSD model.
    if (!isMotion && !model) return;

    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay) return;

    // Reset the motion detector background when starting a new run.
    motionRef.current.reset();
    trackerRef.current.reset();

    let raf = 0;
    let stopped = false;
    let detecting = false;
    let lastDetect = 0;
    let lastTracks: Track[] = [];
    const fpsTimes: number[] = [];

    const loop = async (now: number) => {
      if (stopped) return;
      const s = getSettings();
      const useMotion = s.detectionMode === "motion";

      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        !detecting &&
        now - lastDetect >= s.detectionIntervalMs
      ) {
        detecting = true;
        lastDetect = now;
        try {
          let detections: Detection[];

          if (useMotion) {
            const ms: MotionSettings = {
              diffThreshold: s.motionThreshold ?? DEFAULT_MOTION_SETTINGS.diffThreshold,
              bgAlpha: s.motionBgAlpha ?? DEFAULT_MOTION_SETTINGS.bgAlpha,
              minBlobPx: s.motionMinBlobPx ?? DEFAULT_MOTION_SETTINGS.minBlobPx,
            };
            detections = motionRef.current.detect(video, ms);
          } else {
            detections = await detectVehicles(
              model!,
              video,
              s.enabledTypes,
              s.confidence
            );
          }

          lastTracks = trackerRef.current.update(
            detections,
            video.videoWidth,
            video.videoHeight
          );

          const linePx = lineToPixels(getLine(), video.videoWidth, video.videoHeight);
          for (const t of lastTracks) {
            if (t.counted || t.missed > 0) continue;
            const dir = crossDirection(linePx, t.prevCx, t.prevCy, t.cx, t.cy);
            if (dir) {
              t.counted = true;
              const flag = useMotion
                ? { flagged: false, reason: "" }
                : evaluateFlag(t, lastTracks, s);
              onCountRef.current({
                direction: dir,
                vehicleType: t.type,
                confidence: t.score,
                flagged: flag.flagged,
                reason: flag.reason,
                snapshotUrl: captureSnapshot(video),
              });
            }
          }

          fpsTimes.push(now);
          while (fpsTimes.length && now - fpsTimes[0] > 1000) fpsTimes.shift();
          setStats({
            fps: fpsTimes.length,
            tensors: useMotion ? 0 : liveTensorCount(),
            trackCount: lastTracks.length,
            warming: useMotion && !motionRef.current.isWarmedUp,
          });
        } catch {
          // Transient frame errors ignored.
        } finally {
          detecting = false;
        }
      }

      drawOverlay(overlay, video, lastTracks, getLine(), getSettings());
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // Re-run if the mode flips (e.g. settings changed and model just loaded).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, enabled, videoRef, overlayRef, getSettings, getLine]);

  return stats;
}

function captureSnapshot(video: HTMLVideoElement): string | undefined {
  if (!video.videoWidth) return undefined;
  try {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    c.getContext("2d")!.drawImage(video, 0, 0, 160, 90);
    return c.toDataURL("image/jpeg", 0.5);
  } catch {
    return undefined;
  }
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  tracks: Track[],
  line: LineConfig,
  settings: SessionSettings
) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  // Counting line.
  const px = lineToPixels(line, w, h);
  ctx.lineWidth = Math.max(3, w / 320);
  ctx.strokeStyle = "#f8fafc";
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(px.ax, px.ay);
  ctx.lineTo(px.bx, px.by);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [hx, hy] of [[px.ax, px.ay], [px.bx, px.by]]) {
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(10, w / 90), 0, Math.PI * 2);
    ctx.fill();
  }

  if (!settings.showBoxes) return;

  ctx.font = `${Math.max(14, w / 50)}px system-ui, sans-serif`;
  ctx.textBaseline = "bottom";
  for (const t of tracks) {
    const color = t.counted ? "#94a3b8" : "#22c55e";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, w / 480);
    ctx.strokeRect(t.bbox[0], t.bbox[1], t.bbox[2], t.bbox[3]);
    const label = `${t.type} ${(t.score * 100) | 0}%`;
    ctx.fillStyle = color;
    ctx.fillText(label, t.bbox[0] + 2, t.bbox[1] - 2);
  }
}
