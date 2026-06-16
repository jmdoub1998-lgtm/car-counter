import type { VehicleType } from "../types";
import type { Detection } from "./detector";

/**
 * Background-subtraction vehicle detector.
 *
 * Designed for steep overhead camera angles (bridge / multi-storey) where
 * COCO-SSD fails because it was trained on ground-level images. Instead of
 * recognising what a vehicle looks like, we detect that something is MOVING.
 *
 * Algorithm per frame:
 *   1. Downscale frame to a fixed working resolution (fast pixel ops).
 *   2. Convert to grayscale.
 *   3. Compute absolute diff from an exponential-moving-average background model.
 *   4. Apply threshold → binary motion mask.
 *   5. Box-blur mask to merge fragmented motion regions.
 *   6. Find connected blobs (BFS flood-fill).
 *   7. Filter by size; estimate vehicle type from blob area.
 *   8. Scale bounding boxes back to source video coordinates.
 *
 * Parked roadside cars: the background model learns slowly (alpha ≈ 0.002),
 * so a car parked for ~10 minutes starts fading into the background and stops
 * triggering — exactly the desired behaviour.
 */

const WORK_W = 320;
const WORK_H = 180;

interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number; // pixel count at working resolution
}

export interface MotionSettings {
  /**
   * Pixel luminance difference (0-255) required to classify a pixel as
   * "moving". Higher → less sensitive (fewer false positives from shadows /
   * vibration). Lower → catches subtler motion (motorcycles, slow vehicles).
   */
  diffThreshold: number;
  /**
   * Background model learning rate (0..1). Lower = slower to absorb stopped
   * vehicles back into background. Recommended: 0.001–0.005.
   */
  bgAlpha: number;
  /**
   * Minimum blob area (pixels at 320×180) to consider a detection.
   * At a 12-storey height, a car ≈ 60–200 px, truck ≈ 200–500 px.
   */
  minBlobPx: number;
  /**
   * Multiplier applied when classifying vehicle type by blob size. Increase
   * if vehicles are classified one size too big for your camera's distance/
   * angle (e.g. cars showing up as trucks, motorcycles as cars); decrease if
   * too small. Defaults to 1 (the built-in size thresholds).
   */
  sizeScale: number;
}

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  diffThreshold: 18,
  bgAlpha: 0.002,
  minBlobPx: 60,
  sizeScale: 1,
};

export class MotionDetector {
  private bg: Float32Array | null = null;
  private warmupFrames = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORK_W;
    this.canvas.height = WORK_H;
    this.ctx = this.canvas.getContext("2d", {
      willReadFrequently: true,
      alpha: false,
    })!;
  }

  /**
   * Detect moving vehicles in a video frame. Returns detections in the
   * coordinate space of the source video (not the working resolution).
   */
  detect(
    video: HTMLVideoElement,
    settings: MotionSettings,
    zoom = 1
  ): Detection[] {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return [];

    // Crop to the zoomed viewport (centered) so the detector sees only what
    // the user sees — this cuts edge noise and improves detail in the ROI.
    const srcW = vw / zoom;
    const srcH = vh / zoom;
    const srcX = (vw - srcW) / 2;
    const srcY = (vh - srcH) / 2;
    this.ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, WORK_W, WORK_H);
    const frame = this.ctx.getImageData(0, 0, WORK_W, WORK_H).data;

    // Grayscale
    const gray = toGray(frame);

    if (!this.bg) {
      this.bg = new Float32Array(gray);
      return [];
    }

    // Let the background model stabilise for a moment before counting.
    this.warmupFrames++;
    if (this.warmupFrames < 10) {
      updateBg(this.bg, gray, settings.bgAlpha * 5); // fast init
      return [];
    }

    // Binary motion mask
    const mask = diffMask(gray, this.bg, settings.diffThreshold);

    // Box-blur mask 3× to merge nearby motion pixels (handles vehicle
    // fragmentation at steep angles where roof, bonnet, boot appear separately).
    boxBlur(mask, WORK_W, WORK_H);
    boxBlur(mask, WORK_W, WORK_H);
    boxBlur(mask, WORK_W, WORK_H);

    // Update background only on stationary pixels.
    updateBgSelective(this.bg, gray, mask, settings.bgAlpha);

    // Find moving blobs.
    const blobs = findBlobs(mask, WORK_W, WORK_H, settings.minBlobPx);

    // Scale back to full source-video coordinates (not just the cropped region).
    const scaleX = srcW / WORK_W;
    const scaleY = srcH / WORK_H;

    return blobs.map((b) => {
      const w = (b.maxX - b.minX) * scaleX;
      const h = (b.maxY - b.minY) * scaleY;
      return {
        bbox: [srcX + b.minX * scaleX, srcY + b.minY * scaleY, w, h] as [
          number,
          number,
          number,
          number,
        ],
        type: typeFromBlob(b, zoom, settings.sizeScale),
        score: Math.min(0.5 + b.area / (zoom * zoom) / (settings.minBlobPx * 6), 0.99),
      };
    });
  }

  /** Call when the session/camera restarts so the stale background is cleared. */
  reset() {
    this.bg = null;
    this.warmupFrames = 0;
  }

  /** How many frames until the background model is considered stable. */
  get isWarmedUp(): boolean {
    return this.warmupFrames >= 10;
  }
}

// ---- helpers ----------------------------------------------------------------

function toGray(rgba: Uint8ClampedArray): Float32Array {
  const n = WORK_W * WORK_H;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    g[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
  }
  return g;
}

function diffMask(
  gray: Float32Array,
  bg: Float32Array,
  threshold: number
): Uint8Array {
  const n = WORK_W * WORK_H;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = Math.abs(gray[i] - bg[i]) > threshold ? 1 : 0;
  }
  return mask;
}

function updateBg(bg: Float32Array, gray: Float32Array, alpha: number) {
  for (let i = 0; i < bg.length; i++) {
    bg[i] = bg[i] * (1 - alpha) + gray[i] * alpha;
  }
}

function updateBgSelective(
  bg: Float32Array,
  gray: Float32Array,
  mask: Uint8Array,
  alpha: number
) {
  for (let i = 0; i < bg.length; i++) {
    if (!mask[i]) bg[i] = bg[i] * (1 - alpha) + gray[i] * alpha;
  }
}

/** In-place 3×3 box-blur of a binary mask (threshold at 0.5 after). */
function boxBlur(mask: Uint8Array, W: number, H: number) {
  const tmp = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const sum =
        mask[(y - 1) * W + x - 1] +
        mask[(y - 1) * W + x] +
        mask[(y - 1) * W + x + 1] +
        mask[y * W + x - 1] +
        mask[y * W + x] +
        mask[y * W + x + 1] +
        mask[(y + 1) * W + x - 1] +
        mask[(y + 1) * W + x] +
        mask[(y + 1) * W + x + 1];
      tmp[y * W + x] = sum >= 3 ? 1 : 0;
    }
  }
  mask.set(tmp);
}

/** BFS connected-components on a binary mask. Returns blobs above minArea. */
function findBlobs(
  mask: Uint8Array,
  W: number,
  H: number,
  minArea: number
): Blob[] {
  const visited = new Uint8Array(W * H);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || visited[start]) continue;

    stack.length = 0;
    stack.push(start);
    let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;

    while (stack.length) {
      const i = stack.pop()!;
      if (i < 0 || i >= W * H || visited[i] || !mask[i]) continue;
      visited[i] = 1;
      const x = i % W;
      const y = (i / W) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      area++;
      if (x > 0) stack.push(i - 1);
      if (x < W - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - W);
      if (y < H - 1) stack.push(i + W);
    }

    if (area >= minArea) {
      blobs.push({ minX, minY, maxX: maxX + 1, maxY: maxY + 1, area });
    }
  }

  return blobs;
}

/**
 * Heuristic vehicle type from blob area (pixels at 320×180).
 * At a 12-storey overhead view the size ordering still holds even if the
 * absolute pixel counts differ from the defaults below. Users can tune
 * sizeScale (or diffThreshold / minBlobPx) to refine.
 *
 * Area is normalized by zoom² because digital zoom crops the working frame —
 * the same physical vehicle fills proportionally more of it, so raw area
 * would otherwise misclassify vehicles as the zoom level changes.
 */
function typeFromBlob(b: Blob, zoom: number, sizeScale: number): VehicleType {
  const area = b.area / (zoom * zoom) / sizeScale;
  if (area < 120) return "motorcycle";
  if (area < 400) return "car";
  if (area < 900) return "truck";
  return "bus";
}
