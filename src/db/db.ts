import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  Clip,
  CountEvent,
  DirectionKey,
  Session,
  SessionTotals,
  VehicleType,
} from "../types";
import { DEFAULT_SETTINGS, VEHICLE_TYPES } from "../types";

/**
 * Fill any settings fields that are missing from a stored session (e.g. sessions
 * created before a new field was added). This keeps old sessions working after
 * code changes without a full DB migration.
 */
function migrateSession(s: Session): Session {
  const settings = { ...DEFAULT_SETTINGS, ...s.settings };
  return { ...s, settings };
}

interface CarCounterDB extends DBSchema {
  sessions: {
    key: string;
    value: Session;
    indexes: { "by-startedAt": number; "by-active": "true" | "false" };
  };
  events: {
    key: string;
    value: CountEvent;
    indexes: { "by-session": string; "by-timestamp": number };
  };
  clips: {
    key: string;
    value: Clip;
    indexes: { "by-session": string; "by-timestamp": number };
  };
}

let dbPromise: Promise<IDBPDatabase<CarCounterDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<CarCounterDB>("car-counter", 1, {
      upgrade(db) {
        const sessions = db.createObjectStore("sessions", { keyPath: "id" });
        sessions.createIndex("by-startedAt", "startedAt");
        // Stored as the string "true"/"false" because IndexedDB cannot index booleans.
        sessions.createIndex("by-active", "active" as unknown as never);

        const events = db.createObjectStore("events", { keyPath: "id" });
        events.createIndex("by-session", "sessionId");
        events.createIndex("by-timestamp", "timestamp");

        const clips = db.createObjectStore("clips", { keyPath: "id" });
        clips.createIndex("by-session", "sessionId");
        clips.createIndex("by-timestamp", "timestamp");
      },
    });
  }
  return dbPromise;
}

export function newId(prefix = ""): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${rand}` : rand;
}

// ---- Sessions ----

export async function putSession(session: Session): Promise<void> {
  const db = await getDb();
  await db.put("sessions", session);
}

export async function getSession(id: string): Promise<Session | undefined> {
  const db = await getDb();
  const s = await db.get("sessions", id);
  return s ? migrateSession(s) : undefined;
}

export async function listSessions(): Promise<Session[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("sessions", "by-startedAt");
  return all.reverse().map(migrateSession); // newest first
}

/** A session left `active` means the app crashed/reloaded mid-run; offer to resume. */
export async function getActiveSession(): Promise<Session | undefined> {
  const db = await getDb();
  const all = await db.getAll("sessions");
  const active = all.find((s) => s.active);
  return active ? migrateSession(active) : undefined;
}

export async function endSession(id: string): Promise<void> {
  const db = await getDb();
  const s = await db.get("sessions", id);
  if (s) {
    s.active = false;
    s.endedAt = s.endedAt ?? Date.now();
    await db.put("sessions", s);
  }
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["sessions", "events", "clips"], "readwrite");
  await tx.objectStore("sessions").delete(id);
  for (const store of ["events", "clips"] as const) {
    const idx = tx.objectStore(store).index("by-session");
    let cursor = await idx.openCursor(id);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

// ---- Events ----

/** Persist a single count immediately (crash-safe; never batched). */
export async function addEvent(event: CountEvent): Promise<void> {
  const db = await getDb();
  await db.put("events", event);
}

export async function getEvents(sessionId: string): Promise<CountEvent[]> {
  const db = await getDb();
  const events = await db.getAllFromIndex("events", "by-session", sessionId);
  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

// ---- Clips ----

export async function addClip(clip: Clip): Promise<void> {
  const db = await getDb();
  await db.put("clips", clip);
  await enforceClipBudget(clip.sessionId);
}

export async function getClip(id: string): Promise<Clip | undefined> {
  const db = await getDb();
  return db.get("clips", id);
}

export async function getClips(sessionId: string): Promise<Clip[]> {
  const db = await getDb();
  const clips = await db.getAllFromIndex("clips", "by-session", sessionId);
  clips.sort((a, b) => b.timestamp - a.timestamp);
  return clips;
}

/** Total bytes used by clips for a session. */
export async function clipBytesUsed(sessionId: string): Promise<number> {
  const clips = await getClips(sessionId);
  return clips.reduce((sum, c) => sum + c.bytes, 0);
}

/** Evict oldest clips until the session is within its configured budget. */
async function enforceClipBudget(sessionId: string): Promise<void> {
  const db = await getDb();
  const session = await db.get("sessions", sessionId);
  if (!session) return;
  const budgetBytes = session.settings.clipBudgetMb * 1024 * 1024;

  const clips = (await getClips(sessionId)).sort((a, b) => a.timestamp - b.timestamp);
  let used = clips.reduce((sum, c) => sum + c.bytes, 0);
  let i = 0;
  while (used > budgetBytes && i < clips.length) {
    const oldest = clips[i++];
    await db.delete("clips", oldest.id);
    used -= oldest.bytes;
    // Unlink the clip from its event so the UI stops offering playback.
    const ev = await db.get("events", oldest.eventId);
    if (ev && ev.clipId === oldest.id) {
      ev.clipId = undefined;
      await db.put("events", ev);
    }
  }
}

// ---- Aggregation ----

export function emptyTotals(): SessionTotals {
  const byType = Object.fromEntries(VEHICLE_TYPES.map((t) => [t, 0])) as Record<
    VehicleType,
    number
  >;
  const mk = () => ({ ...byType });
  return {
    total: 0,
    byDirection: { A: 0, B: 0 },
    byType: mk(),
    byDirectionAndType: { A: mk(), B: mk() },
  };
}

export function computeTotals(events: CountEvent[]): SessionTotals {
  const totals = emptyTotals();
  for (const e of events) {
    totals.total++;
    totals.byDirection[e.direction as DirectionKey]++;
    totals.byType[e.vehicleType]++;
    totals.byDirectionAndType[e.direction as DirectionKey][e.vehicleType]++;
  }
  return totals;
}

export async function getSessionTotals(sessionId: string): Promise<SessionTotals> {
  return computeTotals(await getEvents(sessionId));
}
