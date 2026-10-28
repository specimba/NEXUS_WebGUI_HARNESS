// r677: the family-witness note contract, lifted to a shared lib. The r676
// panel/fixture duplication was intentional then; this kills it. The runner
// composes verdict notes as (via + crossFamilyTag) — crossFamilyTag emits
// " · cross-family" | " · same-family" (leading space, systemone.ts). The
// run-panel chips the token; censuses tally it. Never-throw: non-strings
// and unwitnessed notes → null.
export type FamilyWitness = "cross" | "same";

export interface FamilyWitnessSplit {
  head: string;
  witness: FamilyWitness;
  tail: string;
}

export interface FamilyTally {
  cross: number;
  same: number;
}

const WITNESS_RE = /· (cross-family|same-family)/;

/**
 * Split the witness token out of a family-witnessed verdict note.
 * Returns null when the note carries no witness (pre-r673 notes, plain
 * rework/loop notes, junk) — callers render/tally nothing in that case.
 * The head/tail preserve every other byte, so note-head anchoring
 * (gateEventsOf census contract) stays intact.
 */
export function splitFamilyWitness(note: string | null | undefined): FamilyWitnessSplit | null {
  if (typeof note !== "string") return null;
  const m = note.match(WITNESS_RE);
  if (!m || m.index === undefined) return null;
  return {
    head: note.slice(0, m.index),
    witness: m[1] === "cross-family" ? "cross" : "same",
    tail: note.slice(m.index + m[0].length),
  };
}

/**
 * Tally witnessed notes: how many judge notes are family-disjoint (cross)
 * vs same-family (same). Unwitnessed notes are skipped silently.
 */
export function familyTallyOf(notes: Array<string | null | undefined>): FamilyTally {
  const tally: FamilyTally = { cross: 0, same: 0 };
  for (const n of notes) {
    const w = splitFamilyWitness(n)?.witness;
    if (w === "cross") tally.cross++;
    else if (w === "same") tally.same++;
  }
  return tally;
}
