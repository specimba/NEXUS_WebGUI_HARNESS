// ─── r656: call-log lane lineage — O1 evidence as data, not prose ────────────
// The lane-health chips used to STRING-MATCH the note's v11b prose prefixes
// ("server relay…", "browser-direct…"). That made prose load-bearing: a
// reworded note would silently miscount lanes. The writer now stamps a
// structured lane (from res.transport — the actual dial wire), and this
// module is the single reader the run panel shares with the schema
// (one-adapter doctrine: writer and reader can never drift).
export type CallLogLane = "server-relay" | "browser-direct";

export interface CallLogLaneEntry {
  lane?: CallLogLane;
  note?: string;
}

/**
 * Structured field first; pre-r656 rows fall back to the v11b note prefixes
 * so old persisted logs keep counting honestly; anything else is an honest
 * null — never guessed, never invented (r411 class). Never throws.
 */
export function laneOfEntry(c: CallLogLaneEntry | null | undefined): CallLogLane | null {
  try {
    if (!c) return null;
    if (c.lane) return c.lane;
    const n = typeof c.note === "string" ? c.note : "";
    if (n.startsWith("server relay")) return "server-relay";
    if (n.startsWith("browser-direct")) return "browser-direct";
    return null;
  } catch {
    return null;
  }
}
