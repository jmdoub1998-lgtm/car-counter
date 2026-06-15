import type { VehicleType } from "../types";
import type { Detection } from "./detector";

export interface Track {
  id: number;
  type: VehicleType;
  score: number;
  /** Current bbox [x, y, w, h] in video pixels. */
  bbox: [number, number, number, number];
  /** Current center. */
  cx: number;
  cy: number;
  /** Previous center (one update ago) — used for line-crossing tests. */
  prevCx: number;
  prevCy: number;
  /** Estimated per-frame velocity, used to predict the next position. */
  vx: number;
  vy: number;
  /** Frames since this track was last matched to a detection. */
  missed: number;
  /** True once this track has been counted, so it is never double-counted. */
  counted: boolean;
}

function centerOf(b: [number, number, number, number]): [number, number] {
  return [b[0] + b[2] / 2, b[1] + b[3] / 2];
}

function iou(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  if (inter <= 0) return 0;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return inter / union;
}

/**
 * Lightweight tracker that assigns stable ids across frames. Because detection on
 * a phone runs at a low frame rate, a fast vehicle can move farther than its own
 * box between frames — so IOU alone fails. We instead associate a detection to the
 * track whose *velocity-predicted* center is nearest, within a generous gate that
 * scales with both the box size and the frame width. Tuned for "approximate"
 * counting, not a research benchmark.
 */
export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(private readonly maxMissed = 8) {}

  /**
   * Feed the latest detections (and the source frame size) and get the live tracks.
   */
  update(detections: Detection[], frameW = 1280, frameH = 720): Track[] {
    const unmatchedDet = new Set(detections.map((_, i) => i));
    const usedTracks = new Set<number>();

    // Build candidate pairs scored by association quality (higher = better).
    interface Pair {
      ti: number;
      di: number;
      score: number;
    }
    const pairs: Pair[] = [];
    this.tracks.forEach((t, ti) => {
      // Predicted center assuming constant velocity.
      const predX = t.cx + t.vx;
      const predY = t.cy + t.vy;
      detections.forEach((d, di) => {
        const [dcx, dcy] = centerOf(d.bbox);
        const dist = Math.hypot(dcx - predX, dcy - predY);
        const maxDim = Math.max(t.bbox[2], t.bbox[3], d.bbox[2], d.bbox[3]);
        // Gate: allow up to ~4 box-widths, or 15% of the larger frame dimension
        // of motion between frames (handles fast vehicles at low FPS).
        const gate = Math.max(maxDim * 4, Math.max(frameW, frameH) * 0.15);
        const overlap = iou(t.bbox, d.bbox);
        if (overlap > 0.1) {
          pairs.push({ ti, di, score: 10 + overlap }); // overlapping pairs win
        } else if (dist <= gate) {
          pairs.push({ ti, di, score: 1 - dist / gate }); // closer = higher
        }
      });
    });
    pairs.sort((a, b) => b.score - a.score);

    for (const { ti, di } of pairs) {
      if (usedTracks.has(ti) || !unmatchedDet.has(di)) continue;
      usedTracks.add(ti);
      unmatchedDet.delete(di);
      const t = this.tracks[ti];
      const d = detections[di];
      const [cx, cy] = centerOf(d.bbox);
      t.prevCx = t.cx;
      t.prevCy = t.cy;
      // Smooth the velocity estimate a little to ride out jitter.
      t.vx = 0.5 * t.vx + 0.5 * (cx - t.cx);
      t.vy = 0.5 * t.vy + 0.5 * (cy - t.cy);
      t.cx = cx;
      t.cy = cy;
      t.bbox = d.bbox;
      t.type = d.type;
      t.score = d.score;
      t.missed = 0;
    }

    // Unmatched detections become new tracks.
    for (const di of unmatchedDet) {
      const d = detections[di];
      const [cx, cy] = centerOf(d.bbox);
      this.tracks.push({
        id: this.nextId++,
        type: d.type,
        score: d.score,
        bbox: d.bbox,
        cx,
        cy,
        prevCx: cx,
        prevCy: cy,
        vx: 0,
        vy: 0,
        missed: 0,
        counted: false,
      });
    }

    // Age unmatched tracks; coast them along their last velocity so a brief miss
    // (occlusion) doesn't break the identity, then drop stale ones.
    this.tracks.forEach((t, ti) => {
      if (!usedTracks.has(ti)) {
        t.missed++;
        t.prevCx = t.cx;
        t.prevCy = t.cy;
        t.cx += t.vx;
        t.cy += t.vy;
      }
    });
    this.tracks = this.tracks.filter((t) => t.missed <= this.maxMissed);

    return this.tracks;
  }

  reset() {
    this.tracks = [];
  }
}
