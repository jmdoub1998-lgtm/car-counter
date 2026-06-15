import type { DirectionKey, LineConfig } from "../types";

/** Signed side of point (px,py) relative to directed line a->b. */
function sideOf(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number
): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/** Do segments p1->p2 and p3->p4 intersect? */
function segmentsIntersect(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  p4x: number,
  p4y: number
): boolean {
  const d1 = sideOf(p3x, p3y, p4x, p4y, p1x, p1y);
  const d2 = sideOf(p3x, p3y, p4x, p4y, p2x, p2y);
  const d3 = sideOf(p1x, p1y, p2x, p2y, p3x, p3y);
  const d4 = sideOf(p1x, p1y, p2x, p2y, p4x, p4y);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Line endpoints in source-video pixel coordinates. */
export interface LinePixels {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/** Convert a normalized line config to pixel coordinates for a given frame size. */
export function lineToPixels(
  line: LineConfig,
  width: number,
  height: number
): LinePixels {
  return {
    ax: line.ax * width,
    ay: line.ay * height,
    bx: line.bx * width,
    by: line.by * height,
  };
}

/**
 * If the path prev->cur crosses the line, returns the direction; otherwise null.
 * Direction is decided by which side the vehicle moved TO: crossing onto the
 * positive side of the directed line a->b is "A", onto the negative side is "B".
 * (The labels are just the two roadway directions; which is which is consistent
 * for a given line orientation.)
 */
export function crossDirection(
  line: LinePixels,
  prevX: number,
  prevY: number,
  curX: number,
  curY: number
): DirectionKey | null {
  if (
    !segmentsIntersect(
      prevX,
      prevY,
      curX,
      curY,
      line.ax,
      line.ay,
      line.bx,
      line.by
    )
  ) {
    return null;
  }
  const after = sideOf(line.ax, line.ay, line.bx, line.by, curX, curY);
  return after >= 0 ? "A" : "B";
}
