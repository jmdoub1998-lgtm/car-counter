import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Clip, CountEvent, LineConfig, Session, SessionSettings } from "../types";
import {
  addClip,
  addEvent,
  computeTotals,
  endSession,
  getEvents,
  getSession,
  newId,
  putSession,
} from "../db/db";
import { useCamera } from "../hooks/useCamera";
import { useCounter, type CountPayload } from "../hooks/useCounter";
import { useClipRecorder } from "../hooks/useClipRecorder";
import { useWakeLock } from "../hooks/useWakeLock";
import { useWatchdog } from "../runtime/watchdog";
import { loadDetector, type DetectorBase } from "../cv/detector";
import { clientToNormalized } from "../cv/coverMapping";
import SettingsDrawer from "../components/SettingsDrawer";
import type * as cocoSsd from "@tensorflow-models/coco-ssd";

export default function LiveCount() {
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<Session | null>(null);
  const [counts, setCounts] = useState<{ A: number; B: number }>({ A: 0, B: 0 });
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  // modelLoading is only relevant when mode === "coco-ssd"
  const [modelLoading, setModelLoading] = useState(false);
  const [loadedBase, setLoadedBase] = useState<DetectorBase>("mobilenet_v2");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Live-editable copies kept in refs so the detection loop reads fresh values
  // without restarting.
  const [settings, setSettings] = useState<SessionSettings | null>(null);
  const [line, setLine] = useState<LineConfig | null>(null);
  const settingsRef = useRef<SessionSettings | null>(null);
  const lineRef = useRef<LineConfig | null>(null);
  settingsRef.current = settings;
  lineRef.current = line;

  const [zoom, setZoom] = useState(1);
  const [tuneOpen, setTuneOpen] = useState(false);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;

  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(orientation: landscape)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const camera = useCamera();
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const dragEndpoint = useRef<"a" | "b" | null>(null);
  // Track all active pointers for pinch-to-zoom
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchDistRef = useRef<number | null>(null);

  // ---- Load session + model ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) return navigate("/");
      const s = await getSession(sessionId);
      if (!s) return navigate("/");
      if (cancelled) return;
      setSession(s);
      setSettings(s.settings);
      setLine(s.lineConfig);
      // Resume: seed counts from already-stored events.
      const totals = computeTotals(await getEvents(s.id));
      if (!cancelled) setCounts({ A: totals.byDirection.A, B: totals.byDirection.B });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  // Only load the COCO-SSD model when it is actually needed.
  useEffect(() => {
    if (!session) return;
    if (session.settings.detectionMode !== "coco-ssd") return;
    let cancelled = false;
    const base: DetectorBase = session.settings.detectorBase ?? "mobilenet_v2";
    setLoadedBase(base);
    setModelLoading(true);
    loadDetector(base).then(
      (m) => { if (!cancelled) { setModel(m); setModelLoading(false); } },
      () => { if (!cancelled) setModelLoading(false); }
    );
    return () => { cancelled = true; };
  // Re-run only when session first loads or mode changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.settings.detectionMode]);

  // Auto-start the camera once we have a session (first run needs the Start button
  // due to gesture requirements; this handles already-granted permissions).
  useEffect(() => {
    if (session && camera.status === "idle") camera.startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Best-effort geolocation tag (once per session, never blocks counting).
  useEffect(() => {
    if (!session || session.location || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        persist({
          location: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const isMotionMode = settings?.detectionMode === "motion";
  // Motion mode needs no model; COCO-SSD mode needs the model loaded.
  const running =
    camera.status === "running" && (isMotionMode || !!model);

  // ---- Persist edits (labels / line / settings) ----
  const persist = useCallback(
    (patch: Partial<Session>) => {
      setSession((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        putSession(next);
        return next;
      });
    },
    []
  );

  const updateSettings = useCallback(
    (next: SessionSettings) => {
      setSettings(next);
      persist({ settings: next });
    },
    [persist]
  );

  const updateLine = useCallback(
    (next: LineConfig) => {
      setLine(next);
      persist({ lineConfig: next });
    },
    [persist]
  );

  // ---- Clip recorder + wake lock + watchdog ----
  // Clip recording disabled: MediaRecorder stop/restart stalls the camera pipeline
  // on mobile (iPhone), causing visible flashes and detection dropouts. Snapshots
  // are captured instead (see captureSnapshot in useCounter).
  const { saveClip } = useClipRecorder(camera.stream, settings?.clipSeconds ?? 8, false);
  const wake = useWakeLock(running);

  // ---- Counting callback ----
  const onCount = useCallback(
    async (payload: CountPayload) => {
      if (!session) return;
      setCounts((c) => ({ ...c, [payload.direction]: c[payload.direction] + 1 }));
      const event: CountEvent = {
        id: newId("e"),
        sessionId: session.id,
        timestamp: Date.now(),
        direction: payload.direction,
        vehicleType: payload.vehicleType,
        confidence: payload.confidence,
        flagged: payload.flagged,
        reason: payload.reason || undefined,
        snapshotUrl: payload.snapshotUrl,
      };
      await addEvent(event);

      if (payload.flagged && settingsRef.current?.clipsEnabled) {
        const blob = await saveClip();
        if (blob) {
          const clip: Clip = {
            id: newId("c"),
            sessionId: session.id,
            eventId: event.id,
            timestamp: event.timestamp,
            reason: payload.reason || "flagged",
            blob,
            bytes: blob.size,
          };
          await addClip(clip);
          event.clipId = clip.id;
          await addEvent(event); // re-write with clip link
        }
      }
    },
    [session, saveClip]
  );

  const getSettings = useCallback(() => settingsRef.current!, []);
  const getLine = useCallback(() => lineRef.current!, []);
  const getZoom = useCallback(() => zoomRef.current, []);

  const stats = useCounter({
    videoRef: camera.videoRef,
    overlayRef,
    model: isMotionMode ? null : model,
    enabled: running && !!settings && !!line,
    getSettings,
    getLine,
    getZoom,
    onCount,
  });

  // Watchdog only for COCO-SSD mode — motion detection is synchronous pixel ops
  // and can never stall. Enabling it in motion mode caused spurious camera restarts
  // that flashed the start overlay and reset the background model.
  const stalled = useWatchdog(
    running && !isMotionMode,
    stats.fps,
    () => {
      if (camera.stream) camera.startCamera();
    },
    6000
  );

  // ---- Auto-rollover into a fresh session segment ----
  useEffect(() => {
    if (!session || !settings || settings.autoRolloverMinutes <= 0) return;
    const id = window.setTimeout(async () => {
      await endSession(session.id);
      const now = Date.now();
      const next: Session = {
        ...session,
        id: newId("s"),
        name: new Date(now).toLocaleString() + " (cont.)",
        startedAt: now,
        endedAt: null,
        active: true,
      };
      await putSession(next);
      navigate(`/count/${next.id}`, { replace: true });
    }, settings.autoRolloverMinutes * 60 * 1000);
    return () => clearTimeout(id);
  }, [session, settings, navigate]);

  // ---- Line dragging + pinch-to-zoom ----

  // De-zoom a client position back to the unscaled video coordinate space.
  const deZoom = (clientX: number, clientY: number, rect: DOMRect) => {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return {
      x: (clientX - cx) / zoomRef.current + cx,
      y: (clientY - cy) / zoomRef.current + cy,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers down → start pinch; cancel any in-progress line drag.
    if (pointersRef.current.size === 2) {
      dragEndpoint.current = null;
      const pts = [...pointersRef.current.values()];
      pinchDistRef.current = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      return;
    }

    if (!containerRef.current || !line) return;
    const v = camera.videoRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const { x, y } = deZoom(e.clientX, e.clientY, rect);
    const { nx, ny } = clientToNormalized(x, y, rect, v?.videoWidth || 1, v?.videoHeight || 1);
    const da = Math.hypot(nx - line.ax, ny - line.ay);
    const db = Math.hypot(nx - line.bx, ny - line.by);
    if (Math.min(da, db) < 0.12) {
      dragEndpoint.current = da <= db ? "a" : "b";
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch zoom
    if (pointersRef.current.size === 2 && pinchDistRef.current !== null) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      setZoom((z) => Math.min(5, Math.max(1, z * (dist / pinchDistRef.current!))));
      pinchDistRef.current = dist;
      return;
    }

    if (!dragEndpoint.current || !containerRef.current || !line) return;
    const v = camera.videoRef.current;
    const rect = containerRef.current.getBoundingClientRect();
    const { x, y } = deZoom(e.clientX, e.clientY, rect);
    const { nx, ny } = clientToNormalized(x, y, rect, v?.videoWidth || 1, v?.videoHeight || 1);
    const next =
      dragEndpoint.current === "a"
        ? { ...line, ax: nx, ay: ny }
        : { ...line, bx: nx, by: ny };
    setLine(next);
    lineRef.current = next;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchDistRef.current = null;
    if (dragEndpoint.current && line) updateLine(line);
    if (pointersRef.current.size === 0) dragEndpoint.current = null;
  };

  // ---- Stop & view summary ----
  const finish = async () => {
    if (session) await endSession(session.id);
    camera.stop();
    navigate(`/summary/${session?.id ?? ""}`);
  };

  const total = counts.A + counts.B;
  const aLabel = session?.directionALabel ?? "Direction A";
  const bLabel = session?.directionBLabel ?? "Direction B";
  const anyStalled = stalled;

  const statusLine = useMemo(() => {
    if (camera.status === "starting") return "Starting camera…";
    if (camera.status === "error") return camera.error ?? "Camera error";
    if (!isMotionMode && modelLoading) return "Loading ML model…";
    if (anyStalled) return "Stalled — recovering…";
    if (stats.warming) return `${stats.fps} fps · calibrating background…`;
    const mode = isMotionMode ? "motion" : "coco-ssd";
    return `${stats.fps} fps · ${stats.trackCount} tracked · ${mode}${
      !isMotionMode ? ` · ${stats.tensors} tensors` : ""
    }`;
  }, [modelLoading, isMotionMode, camera.status, camera.error, anyStalled, stats]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black no-select">
      {/* Camera + overlay — always full-screen behind everything */}
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "none" }}
      >
        <div
          className="absolute inset-0"
          style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
        >
          <video
            ref={camera.videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            muted
          />
          <canvas
            ref={overlayRef}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      </div>

      {/* ── LANDSCAPE layout: single top bar with counters + controls ── */}
      {isLandscape && camera.status === "running" && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-black/70 px-3 py-2">
          {/* Compact inline counters */}
          <div className="flex flex-shrink-0 items-center gap-3">
            <InlineCounter label={aLabel} value={counts.A} color="text-cyan-300" />
            <div className="h-5 w-px bg-slate-600" />
            <InlineCounter label={bLabel} value={counts.B} color="text-amber-300" />
            <div className="h-5 w-px bg-slate-600" />
            <InlineCounter label="Total" value={total} color="text-white" />
          </div>
          {/* Status text — fills remaining space, truncated */}
          <span className="min-w-0 flex-1 truncate text-xs text-slate-400">
            {statusLine}{wake.held ? " · locked" : ""}
          </span>
          {/* Controls */}
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg bg-black/50 px-3 py-2 text-sm ring-1 ring-white/20"
          >
            ⚙
          </button>
          {isMotionMode && (
            <button
              onClick={() => setTuneOpen((o) => !o)}
              className={`rounded-lg px-3 py-2 text-sm ring-1 ring-white/20 ${tuneOpen ? "bg-cyan-500 text-slate-900" : "bg-black/50"}`}
            >
              Tune
            </button>
          )}
          <div className="flex items-center gap-0.5 rounded-lg bg-black/50 px-1.5 py-1 ring-1 ring-white/20">
            <button
              onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
              className="px-2 py-1 text-base font-bold"
            >
              −
            </button>
            <span className="min-w-[32px] text-center text-xs tabular-nums">{zoom.toFixed(1)}×</span>
            <button
              onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))}
              className="px-2 py-1 text-base font-bold"
            >
              +
            </button>
          </div>
          <button
            onClick={finish}
            className="rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white"
          >
            Stop
          </button>
        </div>
      )}

      {/* ── PORTRAIT layout: top counters + status + bottom controls ── */}
      {!isLandscape && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-stretch gap-2 p-3">
            <Counter label={aLabel} value={counts.A} color="text-cyan-300" ring="ring-cyan-400/60" />
            <Counter label={bLabel} value={counts.B} color="text-amber-300" ring="ring-amber-400/60" />
            <div className="flex min-w-[72px] flex-col items-center justify-center rounded-xl bg-black/55 px-3 py-2 ring-1 ring-white/20">
              <span className="text-xs text-slate-300">Total</span>
              <span className="text-2xl font-bold tabular-nums">{total}</span>
            </div>
          </div>
          <div className="absolute left-3 top-[88px] rounded-lg bg-black/50 px-2 py-1 text-xs text-slate-200">
            {statusLine}
            {wake.held ? " · screen lock held" : ""}
          </div>
          {camera.status === "running" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3">
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-xl bg-black/55 px-4 py-3 text-sm ring-1 ring-white/20"
              >
                ⚙
              </button>
              {isMotionMode && (
                <button
                  onClick={() => setTuneOpen((o) => !o)}
                  className={`rounded-xl px-3 py-3 text-sm ring-1 ring-white/20 ${tuneOpen ? "bg-cyan-500 text-slate-900" : "bg-black/55"}`}
                >
                  Tune
                </button>
              )}
              <div className="flex items-center gap-1 rounded-xl bg-black/55 px-2 py-1 ring-1 ring-white/20">
                <button
                  onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
                  className="px-2 py-1 text-lg font-bold"
                >
                  −
                </button>
                <span className="min-w-[36px] text-center text-xs tabular-nums">
                  {zoom.toFixed(1)}×
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(5, +(z + 0.5).toFixed(1)))}
                  className="px-2 py-1 text-lg font-bold"
                >
                  +
                </button>
              </div>
              <DevFilePicker onPick={camera.useFile} compact />
              <button
                onClick={finish}
                className="rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white"
              >
                Stop
              </button>
            </div>
          )}
        </>
      )}

      {/* Start overlay — covers everything when camera not yet running */}
      {camera.status !== "running" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
          <p className="max-w-xs text-slate-200">
            Point the camera at the roadway, then start. Drag the dashed line so
            vehicles cross it.
            {isMotionMode && (
              <span className="mt-1 block text-sm text-slate-400">
                Motion mode: keep the camera still for ~5 seconds while the background
                calibrates, then counting begins automatically.
              </span>
            )}
          </p>
          {camera.status === "error" && (
            <p className="text-sm text-red-300">{camera.error}</p>
          )}
          <button
            onClick={() => camera.startCamera()}
            className="rounded-xl bg-cyan-500 px-6 py-3 text-lg font-semibold text-slate-900"
          >
            Start camera
          </button>
          <DevFilePicker onPick={camera.useFile} />
          <button onClick={() => navigate("/")} className="text-slate-400 underline">
            Back
          </button>
        </div>
      )}

      {/* Quick-tune panel — above bottom bar (portrait) or below top bar (landscape) */}
      {camera.status === "running" && tuneOpen && settings && isMotionMode && (
        <div
          className={`absolute inset-x-3 z-10 rounded-2xl bg-black/85 p-4 ring-1 ring-white/20 ${
            isLandscape ? "top-14 max-h-[75vh] overflow-y-auto" : "bottom-20"
          }`}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Detection tuning</span>
            <button onClick={() => setTuneOpen(false)} className="text-lg leading-none text-slate-400">✕</button>
          </div>
          <QuickSlider
            label={`Sensitivity: ${settings.motionThreshold}`}
            hint="Lower = catches more (subtle cars). Higher = less noise."
            min={5} max={60} step={1}
            value={settings.motionThreshold}
            onChange={(v) => updateSettings({ ...settings, motionThreshold: v })}
          />
          <QuickSlider
            label={`Min vehicle size: ${settings.motionMinBlobPx} px`}
            hint="Lower = detects smaller/distant vehicles."
            min={10} max={300} step={5}
            value={settings.motionMinBlobPx}
            onChange={(v) => updateSettings({ ...settings, motionMinBlobPx: v })}
          />
          <QuickSlider
            label={`Size calibration: ${settings.motionSizeScale.toFixed(2)}×`}
            hint="Raise if cars show as trucks or motorcycles show as cars."
            min={0.3} max={3} step={0.05}
            value={settings.motionSizeScale}
            onChange={(v) => updateSettings({ ...settings, motionSizeScale: v })}
          />
          <QuickSlider
            label={`Check rate: ${settings.detectionIntervalMs} ms`}
            hint="Lower = catches fast vehicles, uses more battery."
            min={50} max={400} step={10}
            value={settings.detectionIntervalMs}
            onChange={(v) => updateSettings({ ...settings, detectionIntervalMs: v })}
          />
          <div className="mt-3 border-t border-slate-700 pt-3">
            <button
              onClick={stats.resetBackground}
              className="w-full rounded-lg bg-slate-700 py-2 text-sm font-medium active:bg-slate-600"
            >
              ↺ Reset background now
            </button>
            <p className="mt-1 text-xs text-slate-400">
              Use after repositioning the camera. Rebuilds the background model from
              the current frame. Counting resumes after ~1 second.
            </p>
          </div>
        </div>
      )}

      {settings && (
        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={updateSettings}
          aLabel={aLabel}
          bLabel={bLabel}
          onLabels={(a, b) => persist({ directionALabel: a, directionBLabel: b })}
          loadedBase={loadedBase}
        />
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  color,
  ring,
}: {
  label: string;
  value: number;
  color: string;
  ring: string;
}) {
  return (
    <div className={`flex flex-1 flex-col items-center rounded-xl bg-black/55 px-3 py-2 ring-1 ${ring}`}>
      <span className="max-w-full truncate text-xs text-slate-200">{label}</span>
      <span className={`text-3xl font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function InlineCounter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function QuickSlider({
  label, hint, min, max, step, value, onChange,
}: {
  label: string; hint: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-0.5 text-sm">{label}</div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function DevFilePicker({
  onPick,
  compact,
}: {
  onPick: (f: File) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`cursor-pointer rounded-xl bg-black/55 text-sm text-slate-200 ring-1 ring-white/20 ${
        compact ? "px-3 py-3" : "px-4 py-2"
      }`}
    >
      {compact ? "🎞 Test clip" : "Or load a test video file"}
      <input
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
    </label>
  );
}
