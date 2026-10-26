// r578 — P2 experiment slice 1: peer blind-scoring quality pass (crew lane).
// The r516 decision gate judges output AGAINST the step assignment; this peer
// is deliberately BLIND — it sees only the output and rates universal quality
// (substance, coherence, completeness, no placeholders). Two independent
// cheap-lane verdicts (the SakanaAI/mass multi-scorer shape on the Intern-tier
// free ladder): a confident blind FAIL triggers ONE bounded revise pass, so a
// step can see at most two rework dials total (primary gate + peer). The peer
// never blocks a run — judge errors fall through to the exact pre-r578
// behavior. Pure module: the runner (workflow-runner.ts) owns the async
// wiring; this file owns the input shape, question, threshold and the
// call-log note vocabulary ("Peer blind score …") the crew panel can count.

import { SYSTEMONE_GATE_CONFIDENCE } from "./systemone";

export const BLIND_REVIEW_QUESTION = {
  id: "peer-blind",
  type: "noul",
  prompt:
    "Blind quality review: you see ONLY the output, no task context. Is it substantive, coherent and complete — real content throughout, no placeholder text, no obviously unfinished sections?",
  criteriaTrue: "the output is substantive, coherent and complete on its own terms",
  criteriaFalse: "the output is thin, incoherent, placeholder-filled or clearly unfinished",
} as const;

/** Blind by construction: no TASK, no STEP, no ASSIGNMENT — output only. */
export function buildBlindReviewInput(output: string): string {
  return `OUTPUT UNDER BLIND REVIEW:\n${output.slice(0, 5000)}`;
}

export function peerBlindShouldRevise(
  peer: { answer: string; confidence: number } | null | undefined,
): boolean {
  return !!peer && peer.answer === "no" && peer.confidence >= SYSTEMONE_GATE_CONFIDENCE;
}

export function peerBlindNote(peer: {
  answer: string;
  confidence: number;
  via: string;
}): string {
  const pct = (peer.confidence * 100).toFixed(0);
  if (peer.answer === "yes" && peer.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
    return `Peer blind score PASS ${pct}% (${peer.via}) — independent reviewer concurs`;
  }
  if (peerBlindShouldRevise(peer)) {
    return `Peer blind score FAIL ${pct}% (${peer.via}) — one blind-revise pass runs`;
  }
  return `Peer blind score UNCERTAIN ${pct}% (${peer.via}) — output accepted unchanged`;
}
