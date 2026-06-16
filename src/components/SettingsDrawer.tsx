import type { DetectorBase, SessionSettings, VehicleType } from "../types";
import { VEHICLE_TYPES } from "../types";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: SessionSettings;
  onChange: (next: SessionSettings) => void;
  aLabel: string;
  bLabel: string;
  onLabels: (a: string, b: string) => void;
  loadedBase: DetectorBase;
}

export default function SettingsDrawer({
  open,
  onClose,
  settings,
  onChange,
  aLabel,
  bLabel,
  onLabels,
  loadedBase,
}: Props) {
  if (!open) return null;
  const set = (patch: Partial<SessionSettings>) => onChange({ ...settings, ...patch });
  const isMotion = settings.detectionMode === "motion";

  const toggleType = (t: VehicleType) => {
    const has = settings.enabledTypes.includes(t);
    set({
      enabledTypes: has
        ? settings.enabledTypes.filter((x) => x !== t)
        : [...settings.enabledTypes, t],
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="h-full w-full max-w-sm overflow-y-auto bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded-lg bg-slate-700 px-3 py-1">
            Done
          </button>
        </div>

        {/* Detection mode — most important setting, shown first */}
        <Section title="Detection mode">
          <div className="mb-3 flex flex-col gap-2">
            <ModeButton
              active={isMotion}
              onClick={() => set({ detectionMode: "motion" })}
              label="Motion detection"
              sub="Overhead / bridge / multi-storey cameras. Detects moving blobs regardless of angle. Fully offline, no model download. Best for steep downward views."
            />
            <ModeButton
              active={!isMotion}
              onClick={() => set({ detectionMode: "coco-ssd" })}
              label="COCO-SSD (ML model)"
              sub="Ground-level or gently-angled cameras. Recognises vehicles by appearance. Requires model download (~6 MB). Poor accuracy from directly overhead."
            />
          </div>
        </Section>

        {/* Motion-specific settings */}
        {isMotion && (
          <Section title="Motion detection tuning">
            <SliderRow
              label={`Sensitivity threshold: ${settings.motionThreshold}`}
              hint="Lower = catches subtle motion (motorcycles, slow vehicles). Higher = ignores shadows and vibration."
              min={5} max={60} step={1}
              value={settings.motionThreshold}
              onChange={(v) => set({ motionThreshold: v })}
            />
            <SliderRow
              label={`Min vehicle size: ${settings.motionMinBlobPx} px`}
              hint="Minimum motion blob area (pixels at 320×180). Raise to ignore small noise; lower to catch motorcycles."
              min={20} max={400} step={10}
              value={settings.motionMinBlobPx}
              onChange={(v) => set({ motionMinBlobPx: v })}
            />
            <SliderRow
              label={`BG learning speed: ${settings.motionBgAlpha.toFixed(3)}`}
              hint="How quickly the background absorbs stopped vehicles. Lower = parked cars disappear from detections sooner."
              min={0.001} max={0.02} step={0.001}
              value={settings.motionBgAlpha}
              onChange={(v) => set({ motionBgAlpha: v })}
            />
            <SliderRow
              label={`Vehicle size calibration: ${settings.motionSizeScale.toFixed(2)}×`}
              hint="Increase if vehicles are classified one size too big (cars showing as trucks, motorcycles as cars). Decrease if too small."
              min={0.3} max={3} step={0.05}
              value={settings.motionSizeScale}
              onChange={(v) => set({ motionSizeScale: v })}
            />
            <p className="mt-1 text-xs text-slate-400">
              Vehicle type (car / truck / bus / motorcycle) is estimated from blob size, not
              appearance — counts are reliable, type breakdown is approximate.
            </p>
          </Section>
        )}

        {/* COCO-SSD-specific settings */}
        {!isMotion && (
          <>
            <Section title="Detection model">
              <div className="flex gap-2">
                {(["mobilenet_v2", "lite_mobilenet_v2"] as DetectorBase[]).map((b) => (
                  <button
                    key={b}
                    onClick={() => set({ detectorBase: b })}
                    className={`flex-1 rounded-lg px-2 py-2 text-xs ${
                      settings.detectorBase === b
                        ? "bg-cyan-500 text-slate-900 font-semibold"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {b === "mobilenet_v2" ? "mobilenet_v2 (accurate)" : "lite (faster)"}
                  </button>
                ))}
              </div>
              {settings.detectorBase !== loadedBase && (
                <p className="mt-1 text-xs text-slate-400">
                  Reload the page to apply the model change.
                </p>
              )}
            </Section>

            <Section title={`Confidence: ${(settings.confidence * 100) | 0}%`}>
              <input
                type="range" min={0.1} max={0.9} step={0.05}
                value={settings.confidence}
                onChange={(e) => set({ confidence: Number(e.target.value) })}
                className="w-full"
              />
            </Section>

            <Section title="Vehicle types counted">
              <div className="flex flex-wrap gap-2">
                {VEHICLE_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => toggleType(t)}
                    className={`rounded-full px-3 py-1 text-sm capitalize ${
                      settings.enabledTypes.includes(t)
                        ? "bg-cyan-500 text-slate-900"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* Shared settings */}
        <Section title="Direction labels">
          <label className="mb-2 block text-sm">
            <span className="text-cyan-300">Direction A</span>
            <input
              className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              value={aLabel}
              onChange={(e) => onLabels(e.target.value, bLabel)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-amber-300">Direction B</span>
            <input
              className="mt-1 w-full rounded-lg bg-slate-800 px-3 py-2"
              value={bLabel}
              onChange={(e) => onLabels(aLabel, e.target.value)}
            />
          </label>
        </Section>

        <Section title={`Detection interval: ${settings.detectionIntervalMs} ms`}>
          <input
            type="range" min={50} max={500} step={25}
            value={settings.detectionIntervalMs}
            onChange={(e) => set({ detectionIntervalMs: Number(e.target.value) })}
            className="w-full"
          />
          <p className="mt-1 text-xs text-slate-400">
            Higher = cooler device, lower FPS. Motion mode can run as fast as 50 ms.
          </p>
        </Section>

        <Section title="Display">
          <Toggle
            label="Show detection boxes"
            checked={settings.showBoxes}
            onChange={(v) => set({ showBoxes: v })}
          />
        </Section>

        <Section title="Clips (uncertain events)">
          <Toggle
            label="Save short clips for flagged events"
            checked={settings.clipsEnabled}
            onChange={(v) => set({ clipsEnabled: v })}
          />
          <label className="mt-3 block text-sm">
            Clip length: {settings.clipSeconds}s
            <input
              type="range" min={4} max={15} step={1}
              value={settings.clipSeconds}
              onChange={(e) => set({ clipSeconds: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <label className="mt-2 block text-sm">
            Storage budget: {settings.clipBudgetMb} MB
            <input
              type="range" min={50} max={2000} step={50}
              value={settings.clipBudgetMb}
              onChange={(e) => set({ clipBudgetMb: Number(e.target.value) })}
              className="w-full"
            />
          </label>
        </Section>

        <Section title="Long run">
          <label className="block text-sm">
            Auto-rollover:{" "}
            {settings.autoRolloverMinutes === 0
              ? "off"
              : `${settings.autoRolloverMinutes} min`}
            <input
              type="range" min={0} max={120} step={15}
              value={settings.autoRolloverMinutes}
              onChange={(e) => set({ autoRolloverMinutes: Number(e.target.value) })}
              className="w-full"
            />
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Splits into fresh segments so one glitch can't lose a whole day.
          </p>
        </Section>
      </div>
    </div>
  );
}

function ModeButton({
  active, onClick, label, sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border-2 p-3 text-left transition ${
        active
          ? "border-cyan-400 bg-cyan-500/10"
          : "border-slate-700 bg-slate-800"
      }`}
    >
      <div className={`text-sm font-semibold ${active ? "text-cyan-300" : "text-slate-200"}`}>
        {active ? "✓ " : ""}{label}
      </div>
      <div className="mt-1 text-xs text-slate-400 leading-relaxed">{sub}</div>
    </button>
  );
}

function SliderRow({
  label, hint, min, max, step, value, onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-sm">{label}</div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <p className="text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 border-t border-slate-800 pt-4">
      <h3 className="mb-2 text-sm font-medium text-slate-200">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between text-left text-sm"
    >
      <span>{label}</span>
      <span
        className={`relative h-6 w-11 rounded-full transition ${
          checked ? "bg-cyan-500" : "bg-slate-600"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
