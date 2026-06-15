/**
 * Convert a pointer position (client coords) into normalized [0..1] video
 * coordinates, accounting for how `object-fit: cover` scales and crops the video
 * inside its container. Used so a dragged counting-line endpoint lands where the
 * user actually touched, regardless of aspect-ratio mismatch.
 */
export function clientToNormalized(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  videoW: number,
  videoH: number
): { nx: number; ny: number } {
  const cw = containerRect.width;
  const ch = containerRect.height;
  if (!videoW || !videoH || !cw || !ch) return { nx: 0.5, ny: 0.5 };

  const scale = Math.max(cw / videoW, ch / videoH);
  const dispW = videoW * scale;
  const dispH = videoH * scale;
  const offsetX = (cw - dispW) / 2;
  const offsetY = (ch - dispH) / 2;

  const px = clientX - containerRect.left;
  const py = clientY - containerRect.top;

  const vx = (px - offsetX) / scale;
  const vy = (py - offsetY) / scale;

  return {
    nx: clamp(vx / videoW, 0, 1),
    ny: clamp(vy / videoH, 0, 1),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
