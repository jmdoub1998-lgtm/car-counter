import "@tensorflow/tfjs-backend-webgl";
import * as tf from "@tensorflow/tfjs-core";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { VehicleType } from "../types";

/** A single detected vehicle in source-video pixel coordinates. */
export interface Detection {
  /** [x, y, width, height] in video pixels. */
  bbox: [number, number, number, number];
  type: VehicleType;
  score: number;
}

const COCO_TO_VEHICLE: Record<string, VehicleType> = {
  car: "car",
  truck: "truck",
  bus: "bus",
  motorcycle: "motorcycle",
};

let modelPromise: Promise<cocoSsd.ObjectDetection> | null = null;

export type DetectorBase = "lite_mobilenet_v2" | "mobilenet_v2";

/**
 * Load COCO-SSD once. `mobilenet_v2` is the default: better accuracy for the
 * overhead/angled views typical of interchange cameras, at a modest speed cost.
 * `lite_mobilenet_v2` is available via settings for lower-end devices.
 *
 * Note: COCO-SSD is trained on ground-level imagery and will struggle with
 * purely top-down aerial views. For best results with a truly overhead camera,
 * a VisDrone/UAVDT-trained YOLO model (exported to TFJS) is recommended and can
 * be loaded via the custom model URL in settings.
 */
export async function loadDetector(
  base: DetectorBase = "mobilenet_v2"
): Promise<cocoSsd.ObjectDetection> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend("webgl");
      await tf.ready();
      return cocoSsd.load({ base });
    })();
  }
  return modelPromise;
}

/** Discard a cached model so a different base can be loaded on next call. */
export function resetDetector(): void {
  modelPromise = null;
}

/**
 * Run detection on a frame and return only enabled vehicle classes above the
 * confidence threshold. COCO-SSD disposes its own intermediate tensors, so no
 * manual tidy is required here; callers should still monitor `tf.memory()`.
 */
export async function detectVehicles(
  model: cocoSsd.ObjectDetection,
  source: HTMLVideoElement | HTMLCanvasElement,
  enabledTypes: VehicleType[],
  minConfidence: number
): Promise<Detection[]> {
  const predictions = await model.detect(source, 20);
  const out: Detection[] = [];
  for (const p of predictions) {
    const type = COCO_TO_VEHICLE[p.class];
    if (!type) continue;
    if (!enabledTypes.includes(type)) continue;
    if (p.score < minConfidence) continue;
    out.push({
      bbox: p.bbox as [number, number, number, number],
      type,
      score: p.score,
    });
  }
  return out;
}

/** Current live tensor count — used by the watchdog to detect memory leaks. */
export function liveTensorCount(): number {
  return tf.memory().numTensors;
}
