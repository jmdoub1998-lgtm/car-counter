import type { VehicleType } from "../types";
import type { Detection } from "./detector";

/** Roboflow prediction as returned by their hosted inference API. */
interface RoboflowPrediction {
  /** Bounding box CENTER x (pixels in the original image). */
  x: number;
  y: number;
  width: number;
  height: number;
  class: string;
  confidence: number;
  detection_id?: string;
}

interface RoboflowResponse {
  predictions: RoboflowPrediction[];
  image?: { width: number; height: number };
}

/**
 * Map Roboflow class labels → our VehicleType. Aerial models use varied
 * label conventions (two-wheeler, motorbike, auto, van, minibus…) so we cast
 * broadly rather than narrowly.
 */
const CLASS_MAP: Record<string, VehicleType> = {
  // Cars / generic vehicles
  car: "car",
  vehicle: "car",
  auto: "car",
  sedan: "car",
  suv: "car",
  // Trucks
  truck: "truck",
  lorry: "truck",
  trailer: "truck",
  van: "truck",
  pickup: "truck",
  // Buses
  bus: "bus",
  minibus: "bus",
  coach: "bus",
  // Motorcycles / two-wheelers
  motorcycle: "motorcycle",
  motorbike: "motorcycle",
  "two-wheeler": "motorcycle",
  "two wheeler": "motorcycle",
  bicycle: "motorcycle",
  bike: "motorcycle",
  scooter: "motorcycle",
};

function mapClass(label: string, enabled: VehicleType[]): VehicleType | null {
  const mapped = CLASS_MAP[label.toLowerCase().trim()];
  if (!mapped || !enabled.includes(mapped)) return null;
  return mapped;
}

/**
 * Snapshot a single frame from the video element at a reduced resolution
 * (faster upload) and encode it as base64 JPEG.
 */
function captureFrame(video: HTMLVideoElement, maxW = 640): string {
  const scale = Math.min(1, maxW / (video.videoWidth || maxW));
  const w = Math.round((video.videoWidth || maxW) * scale);
  const h = Math.round((video.videoHeight || 480) * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
}

/**
 * Run detection via the Roboflow hosted inference API. Each call sends one
 * frame as a base64 JPEG and receives bounding boxes. Coordinates returned by
 * Roboflow are CENTER-based and sized relative to the *downscaled* snapshot;
 * we rescale them back to the original video dimensions so they line up with
 * the source coordinate system used by the tracker and line-crossing tests.
 *
 * The Roboflow publishable key (rf_…) is safe to expose in browser code — it
 * is read-only and only grants inference access to your deployed models.
 */
export async function detectVehiclesRoboflow(
  video: HTMLVideoElement,
  apiKey: string,
  modelId: string,
  version: number,
  minConfidence: number,
  enabledTypes: VehicleType[]
): Promise<Detection[]> {
  const snapW = 640;
  const base64 = captureFrame(video, snapW);
  const scale = (video.videoWidth || snapW) / snapW;

  const url =
    `https://detect.roboflow.com/${encodeURIComponent(modelId)}/${version}` +
    `?api_key=${encodeURIComponent(apiKey)}` +
    `&confidence=${Math.round(minConfidence * 100)}` +
    `&overlap=30` +
    `&format=json`;

  const res = await fetch(url, {
    method: "POST",
    body: base64,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`Roboflow API ${res.status}: ${msg}`);
  }

  const data: RoboflowResponse = await res.json();

  return (data.predictions ?? []).reduce<Detection[]>((acc, p) => {
    const type = mapClass(p.class, enabledTypes);
    if (!type || p.confidence < minConfidence) return acc;
    // Roboflow returns center coords in the downscaled frame — convert to
    // [left, top, width, height] in original video pixels.
    const x = (p.x - p.width / 2) * scale;
    const y = (p.y - p.height / 2) * scale;
    const w = p.width * scale;
    const h = p.height * scale;
    acc.push({ bbox: [x, y, w, h], type, score: p.confidence });
    return acc;
  }, []);
}
