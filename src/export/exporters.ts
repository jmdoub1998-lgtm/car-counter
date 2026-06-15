import type { CountEvent, Session } from "../types";
import { computeTotals } from "../db/db";

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: string | number | boolean | undefined): string {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeName(session: Session): string {
  const base = session.name.replace(/[^\w.-]+/g, "_").slice(0, 40);
  return `car-counts_${base}`;
}

/** One row per vehicle event, with a totals block appended after a blank line. */
export function exportCsv(session: Session, events: CountEvent[]) {
  const dirLabel = (k: "A" | "B") =>
    k === "A" ? session.directionALabel : session.directionBLabel;

  const header = [
    "index",
    "timestamp_iso",
    "epoch_ms",
    "direction_key",
    "direction_label",
    "vehicle_type",
    "confidence",
    "flagged",
    "reason",
    "clip_id",
  ];
  const lines = [header.join(",")];
  events.forEach((e, i) => {
    lines.push(
      [
        i + 1,
        new Date(e.timestamp).toISOString(),
        e.timestamp,
        e.direction,
        dirLabel(e.direction),
        e.vehicleType,
        e.confidence.toFixed(3),
        e.flagged,
        e.reason ?? "",
        e.clipId ?? "",
      ]
        .map(csvCell)
        .join(",")
    );
  });

  // Summary block.
  const totals = computeTotals(events);
  lines.push("");
  lines.push("summary");
  lines.push(["metric", "value"].join(","));
  lines.push(["total", totals.total].join(","));
  lines.push([csvCell(dirLabel("A")), totals.byDirection.A].join(","));
  lines.push([csvCell(dirLabel("B")), totals.byDirection.B].join(","));
  for (const [type, n] of Object.entries(totals.byType)) {
    lines.push([type, n].join(","));
  }

  triggerDownload(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    `${safeName(session)}.csv`
  );
}

/** Full machine-readable export: session metadata, totals and all events. */
export function exportJson(session: Session, events: CountEvent[]) {
  const totals = computeTotals(events);
  const payload = {
    app: "car-counter",
    exportedAt: new Date().toISOString(),
    session: {
      id: session.id,
      name: session.name,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      directionALabel: session.directionALabel,
      directionBLabel: session.directionBLabel,
      location: session.location ?? null,
      notes: session.notes ?? null,
      settings: session.settings,
    },
    totals,
    events: events.map((e) => ({
      ...e,
      timestampIso: new Date(e.timestamp).toISOString(),
    })),
  };
  triggerDownload(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${safeName(session)}.json`
  );
}
