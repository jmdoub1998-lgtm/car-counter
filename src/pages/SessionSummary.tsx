import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Clip, CountEvent, Session } from "../types";
import { VEHICLE_TYPES } from "../types";
import { computeTotals, getClips, getEvents, getSession } from "../db/db";
import { exportCsv, exportJson } from "../export/exporters";

export default function SessionSummary() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [events, setEvents] = useState<CountEvent[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);

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
