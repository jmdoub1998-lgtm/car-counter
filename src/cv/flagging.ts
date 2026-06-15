import type { SessionSettings } from "../types";
import type { Track } from "./tracker";

export interface FlagResult {
  flagged: boolean;
  reason: string;
}

/**
 * Decide whether a counted vehicle is "uncertain/interesting" and therefore worth
 * saving a short clip for. Kept deliberately simple:
 *  - low confidence (just above the accept threshold), or
 *  - the vehicle overlaps closely with another track at the moment of crossing
 *    (occlusion → higher chance of a miscount).
 */
export function evaluateFlag(
  track: Track,
  allTracks: Track[],
  settings: SessionSettings
): FlagResult {
  if (track.score < settings.confidence + 0.12) {
    return { flagged: true, reason: "low-confidence" };
  }
  for (const other of allTracks) {
    if (other.id === track.id) continue;
    const dx = other.cx - track.cx;
    const dy = other.cy - track.cy;
    const dist = Math.hypot(dx, dy);
    const span = (track.bbox[2] + other.bbox[2]) / 2;
    if (dist < span * 0.6) {
      return { flagged: true, reason: "occlusion" };
    }
  }
  return { flagged: false, reason: "" };
}
