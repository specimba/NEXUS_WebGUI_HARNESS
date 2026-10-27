/**
 * r654 — the one honest way to turn a thrown value into a string.
 *
 * Forensic evidence (the Owner's full-data export): persisted run rows carried
 * the literal "[object Object]" as their error — a rejection reason that was
 * a plain object (not an Error) hit `String(err)` and the telemetry died
 * there. `failRun` and the server automation executor both shared the defect.
 *
 * Rules, in order:
 *   null/undefined         → "unknown error"
 *   string                 → itself (capped)
 *   Error                  → .message; empty message falls back to .name
 *   { message: string }    → message          (non-Error envelopes count too)
 *   { error: string }      → error
 *   other object           → JSON.stringify with a cycle guard (capped);
 *                            stringify failure → "[unserializable error]"
 *   number/boolean/bigint  → String(v)
 *
 * Never throws on any input — including circular structures, getter
 * properties that throw, or a hostile JSON.stringify. Empty honest values
 * never render as "" (an empty message falls through to the next rule).
 */

export const SAFE_ERROR_CAP = 300;

function cap(s: string): string {
  return s.length > SAFE_ERROR_CAP ? `${s.slice(0, SAFE_ERROR_CAP)}…` : s;
}

/** Read one string property without ever throwing (hostile getters exist). */
function readString(obj: object, key: string): string | null {
  try {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "string" && v.trim() !== "" ? v : null;
  } catch {
    return null;
  }
}

export function safeErrorMessage(v: unknown): string {
  try {
    if (v == null) return "unknown error";
    if (typeof v === "string") return cap(v);
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
    if (typeof v === "symbol") return String(v);
    if (typeof v === "function") return "[function]";
    // object (and anything else typeof "object") from here
    const msg = readString(v, "message");
    if (msg) return cap(msg);
    const errField = readString(v, "error");
    if (errField) return cap(errField);
    if (v instanceof Error) return cap(readString(v, "name") ?? "unknown error");
    try {
      const seen = new WeakSet<object>();
      const json = JSON.stringify(v, (_key: string, val: unknown) => {
        if (typeof val === "object" && val !== null) {
          if (seen.has(val as object)) return "[circular]";
          seen.add(val as object);
        }
        return val;
      });
      if (typeof json === "string" && json !== "" && json !== "null") return cap(json);
      return "[unserializable error]";
    } catch {
      return "[unserializable error]";
    }
  } catch {
    return "[unserializable error]";
  }
}
