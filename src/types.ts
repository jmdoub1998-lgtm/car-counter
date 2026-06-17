// Shared domain types for the vehicle counter.

/** Vehicle classes we count (subset of COCO labels). */
export type VehicleType = "car" | "truck" | "bus" | "motorcycle";

/** COCO-SSD backbone options. mobilenet_v2 is more accurate; lite is faster. */
export type DetectorBase = "lite_mobilenet_v2" | "mobilenet_v2";

/**
 * Detection mode.
 * - "coco-ssd": ML model, works well from ground-level / angled cameras.
 * - "motion": Background-subtraction, works at ANY angle including straight down.
 *             Ideal for overhead cameras (bridge, multi-storey building).
 *             No model download, fully offline, classifies vehicles by blob size.
 */
export type DetectionMode = "coco-ssd" | "motion";

export const VEHICLE_TYPES: VehicleType[] = ["car", "truck", "bus", "motorcycle"];

/** The two roadway directions. "A" / "B" are stable keys; labels are user-facing. */
export type DirectionKey = "A" | "B";

/** A line drawn over the camera view, in normalized [0..1] coordinates. */
export interface LineConfig {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface SessionSettings {
  /**
   * Which detector to use.
   * "motion" is recommended for steep overhead cameras (bridge / multi-storey).
   * "coco-ssd" is recommended for ground-level or gently-angled cameras.
   */
  detectionMode: DetectionMode;

  // ---- COCO-SSD settings (ignored in motion mode) ----
  /** Minimum detection confidence (0..1). */
  confidence: number;
  /** Which vehicle classes are counted. */
  enabledTypes: VehicleType[];
  /** COCO-SSD backbone. mobilenet_v2 is more accurate; lite is faster. */
  detectorBase: DetectorBase;

  // ---- Motion detection settings (ignored in coco-ssd mode) ----
  /** Pixel luminance diff threshold (0-255) to flag a pixel as moving. */
  motionThreshold: number;
  /** Background learning rate (0..1). Lower = slower to absorb stopped vehicles. */
  motionBgAlpha: number;
  /** Min blob area in pixels at 320×180 working resolution. */
  motionMinBlobPx: number;
  /** Multiplier on vehicle-type size thresholds; tune if car/truck/moto sizing is off. */
  motionSizeScale: number;
  /** Auto-reset the background model every N minutes (0 = off). Corrects lighting drift. */
  motionBgResetIntervalMin: number;

  // ---- Shared settings ----
  /** Run detection at most once every N ms (throttle for heat/FPS). */
  detectionIntervalMs: number;
  /** Draw bounding boxes over the video. */
  showBoxes: boolean;
  /** Save short clips for flagged (uncertain) events. */
  clipsEnabled: boolean;
  /** Rolling clip length in seconds. */
  clipSeconds: number;
  /** Cap for total clip storage in megabytes (oldest evicted first). */
  clipBudgetMb: number;
  /** Start a fresh session segment every N minutes (0 = never). */
  autoRolloverMinutes: number;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  // Default to motion mode — works for the primary use case (overhead camera).
  // Users with ground-level / angled cameras should switch to "coco-ssd".
  detectionMode: "motion",

  confidence: 0.3,
  enabledTypes: ["car", "truck", "bus", "motorcycle"],
  detectorBase: "mobilenet_v2",

  motionThreshold: 18,
  motionBgAlpha: 0.002,
  motionMinBlobPx: 60,
  motionSizeScale: 1,
  motionBgResetIntervalMin: 0,

  detectionIntervalMs: 80,
  showBoxes: true,
  clipsEnabled: true,
  clipSeconds: 8,
  clipBudgetMb: 500,
  autoRolloverMinutes: 0,
};

export interface Session {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  directionALabel: string;
  directionBLabel: string;
  lineConfig: LineConfig;
  settings: SessionSettings;
  notes?: string;
  location?: { lat: number; lon: number; accuracy: number } | null;
  /** Set true while a session is the live/active one (crash-resume detection). */
  active: boolean;
}

export interface CountEvent {
  id: string;
  sessionId: string;
  timestamp: number;
  direction: DirectionKey;
  vehicleType: VehicleType;
  confidence: number;
  flagged: boolean;
  reason?: string;
  clipId?: string;
  /** Low-res JPEG data URL captured at the crossing moment (160×90). */
  snapshotUrl?: string;
}

export interface Clip {
  id: string;
  sessionId: string;
  eventId: string;
  timestamp: number;
  reason: string;
  blob: Blob;
  bytes: number;
}

/** Aggregated totals computed from events for display/export. */
export interface SessionTotals {
  total: number;
  byDirection: Record<DirectionKey, number>;
  byType: Record<VehicleType, number>;
  byDirectionAndType: Record<DirectionKey, Record<VehicleType, number>>;
}
