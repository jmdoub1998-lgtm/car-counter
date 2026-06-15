import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import {
  deleteSession,
  getActiveSession,
  getSessionTotals,
  listSessions,
  newId,
  putSession,
} from "../db/db";

interface Row {
  session: Session;
  total: number;
}

export default function SessionsList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [resumable, setResumable] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const sessions = await listSessions();
    const withTotals = await Promise.all(
      sessions.map(async (session) => ({
        session,
        total: (await getSessionTotals(session.id)).total,
      }))
    );
    setRows(withTotals);
    setResumable((await getActiveSession()) ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function startNew() {
    const now = Date.now();
    const session: Session = {
      id: newId("s"),
      name: new Date(now).toLocaleString(),
      startedAt: now,
      endedAt: null,
      directionALabel: "Direction A",
      directionBLabel: "Direction B",
      // Default counting line: horizontal across the middle of the view.
      lineConfig: { ax: 0.05, ay: 0.5, bx: 0.95, by: 0.5 },
      settings: { ...DEFAULT_SETTINGS },
      active: true,
    };
    await putSession(session);
    navigate(`/count/${session.id}`);
  }

  async function remove(id: string) {
    if (!confirm("Delete this session and its data?")) return;
    await deleteSession(id);
    refresh();
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Car Counter</h1>
      </header>

      {resumable && (
        <button
          onClick={() => navigate(`/count/${resumable.id}`)}
          className="mb-4 w-full rounded-xl bg-amber-500/20 p-4 text-left ring-1 ring-amber-400"
        >
          <div className="font-semibold text-amber-300">Resume unfinished session</div>
          <div className="text-sm text-slate-300">
            {resumable.name} — was still running when the app last closed.
          </div>
        </button>
      )}

      <button
        onClick={startNew}
        className="mb-6 w-full rounded-xl bg-cyan-500 px-4 py-4 text-lg font-semibold text-slate-900 active:bg-cyan-400 no-select"
      >
        + New counting session
      </button>

      <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-slate-400">
        Past sessions
      </h2>

      {loading ? (
        <p className="text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-400">No sessions yet. Start one above.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map(({ session, total }) => (
            <li
              key={session.id}
              className="flex items-center justify-between rounded-xl bg-slate-800 p-3"
            >
              <button
                className="flex-1 text-left"
                onClick={() => navigate(`/summary/${session.id}`)}
              >
                <div className="font-medium">{session.name}</div>
                <div className="text-sm text-slate-400">
                  {total} vehicles{session.active ? " · running" : ""}
                </div>
              </button>
              <button
                onClick={() => remove(session.id)}
                className="ml-3 rounded-lg px-3 py-2 text-sm text-red-300 active:bg-slate-700"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
