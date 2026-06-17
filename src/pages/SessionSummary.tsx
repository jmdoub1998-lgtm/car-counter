import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import JSZip from "jszip";
import type { Clip, CountEvent, Session } from "../types";
import { VEHICLE_TYPES } from "../types";
import { computeTotals, getClips, getEvents, getSession } from "../db/db";
import { exportCsv, exportJson } from "../export/exporters";

async function exportPhotosZip(
  session: Session,
  events: CountEvent[],
  aLabel: string,
  bLabel: string
) {
  const withPhotos = events.filter((e) => e.snapshotUrl);
  if (!withPhotos.length) return;

  const zip = new JSZip();
  const folder = zip.folder("photos")!;

  withPhotos.forEach((e, i) => {
    const base64 = e.snapshotUrl!.replace(/^data:image\/\w+;base64,/, "");
    const d = new Date(e.timestamp);
    const p = (n: number) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    const dir = (e.direction === "A" ? aLabel : bLabel).replace(/\W+/g, "_");
    const name = `${String(i + 1).padStart(4, "0")}_${ts}_${dir}_${e.vehicleType}.jpg`;
    folder.file(name, base64, { base64: true });
  });

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${session.name.replace(/\W+/g, "_")}_photos.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function SessionSummary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<CountEvent[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [exportingZip, setExportingZip] = useState(false);

  useEffect(() => {
    (async () => {
      if (!sessionId) return navigate("/");
      const s = await getSession(sessionId);
      if (!s) return navigate("/");
      setSession(s);
      setEvents(await getEvents(s.id));
      setClips(await getClips(s.id));
    })();
  }, [sessionId, navigate]);

  const totals = useMemo(() => computeTotals(events), [events]);
  const clipUrls = useMemo(
    () => clips.map((c) => ({ clip: c, url: URL.createObjectURL(c.blob) })),
    [clips]
  );
  useEffect(
    () => () => clipUrls.forEach(({ url }) => URL.revokeObjectURL(url)),
    [clipUrls]
  );

  if (!session) {
    return <div className="p-6 text-slate-400">Loading…</div>;
  }

  const aLabel = session.directionALabel;
  const bLabel = session.directionBLabel;
  const maxDir = Math.max(1, totals.byDirection.A, totals.byDirection.B);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-4 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="text-slate-400 underline">
          ← Sessions
        </button>
        {session.active && (
          <button
            onClick={() => navigate(`/count/${session.id}`)}
            className="rounded-lg bg-cyan-500 px-3 py-1 text-sm font-semibold text-slate-900"
          >
            Resume counting
          </button>
        )}
      </header>

      <h1 className="text-xl font-bold">{session.name}</h1>
      <p className="mb-4 text-sm text-slate-400">
        {new Date(session.startedAt).toLocaleString()}
        {session.endedAt
          ? ` → ${new Date(session.endedAt).toLocaleTimeString()}`
          : " · still active"}
      </p>

      {/* Headline totals */}
      <div className="mb-5 grid grid-cols-3 gap-2">
        <Stat label={aLabel} value={totals.byDirection.A} color="text-cyan-300" />
        <Stat label={bLabel} value={totals.byDirection.B} color="text-amber-300" />
        <Stat label="Total" value={totals.total} color="text-slate-100" />
      </div>

      {/* Direction bar chart */}
      <Section title="By direction">
        <Bar label={aLabel} value={totals.byDirection.A} max={maxDir} color="bg-cyan-400" />
        <Bar label={bLabel} value={totals.byDirection.B} max={maxDir} color="bg-amber-400" />
      </Section>

      {/* By vehicle type */}
      <Section title="By vehicle type">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="py-1">Type</th>
              <th className="py-1 text-right">{aLabel}</th>
              <th className="py-1 text-right">{bLabel}</th>
              <th className="py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {VEHICLE_TYPES.map((t) => (
              <tr key={t} className="border-t border-slate-800">
                <td className="py-1 capitalize">{t}</td>
                <td className="py-1 text-right tabular-nums">
                  {totals.byDirectionAndType.A[t]}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {totals.byDirectionAndType.B[t]}
                </td>
                <td className="py-1 text-right font-medium tabular-nums">
                  {totals.byType[t]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* Export */}
      <Section title="Export">
        <div className="flex gap-2">
          <button
            onClick={() => exportCsv(session, events)}
            className="flex-1 rounded-xl bg-slate-700 px-4 py-3 font-medium active:bg-slate-600"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportJson(session, events)}
            className="flex-1 rounded-xl bg-slate-700 px-4 py-3 font-medium active:bg-slate-600"
          >
            Export JSON
          </button>
        </div>
      </Section>

      {/* Detection snapshots */}
      {events.some((e) => e.snapshotUrl) && (
        <Section title={`Detection snapshots (${events.filter((e) => e.snapshotUrl).length})`}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              160×90 JPEG captured at each crossing. ZIP filenames include timestamp,
              direction, and vehicle type.
            </p>
            <button
              onClick={async () => {
                setExportingZip(true);
                try {
                  await exportPhotosZip(session!, events, aLabel, bLabel);
                } finally {
                  setExportingZip(false);
                }
              }}
              disabled={exportingZip}
              className="flex-shrink-0 rounded-lg bg-slate-700 px-3 py-2 text-xs font-medium active:bg-slate-600 disabled:opacity-50"
            >
              {exportingZip ? "Packing…" : "⬇ Export ZIP"}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
            {events
              .filter((e) => e.snapshotUrl)
              .map((e) => (
                <div key={e.id} className="relative overflow-hidden rounded bg-slate-800">
                  <img
                    src={e.snapshotUrl}
                    alt={`${e.vehicleType} ${e.direction}`}
                    className="aspect-video w-full object-cover"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/60 px-1 py-0.5 text-[10px]">
                    <span className={e.direction === "A" ? "text-cyan-300" : "text-amber-300"}>
                      {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="capitalize text-slate-300">{e.vehicleType}</span>
                  </div>
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* Flagged clips */}
      {clipUrls.length > 0 && (
        <Section title={`Flagged clips (${clipUrls.length})`}>
          <p className="mb-2 text-xs text-slate-400">
            Short clips saved around uncertain counts, for manual review.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clipUrls.map(({ clip, url }) => (
              <div key={clip.id} className="rounded-lg bg-slate-800 p-2">
                <video src={url} controls playsInline className="w-full rounded" />
                <div className="mt-1 flex justify-between text-xs text-slate-400">
                  <span>{new Date(clip.timestamp).toLocaleTimeString()}</span>
                  <span className="capitalize">{clip.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {session.location && (
        <p className="mt-4 text-xs text-slate-500">
          Location: {session.location.lat.toFixed(5)}, {session.location.lon.toFixed(5)}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl bg-slate-800 p-3 text-center">
      <div className="truncate text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="mb-2">
      <div className="mb-0.5 flex justify-between text-sm">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
