// r718: the u/nj suffix tokens wear their own tones at every ⚖ chip —
// uncertain in amber (the judge answered below confidence), no-judge muted
// (the step ran ungated) — so an emerald PASS chip can no longer read a
// hidden u/nj tail as clean health (the r670 false-alarm doctrine, now at
// token level). One component, three chips (the r649 single-mapping
// doctrine, render side); the string form in gate-census.ts is DERIVED from
// the same parts, so the vocabulary cannot drift.
import { censusChipSuffixParts } from "@/lib/gate-census";

const TONE: Record<"uncertain" | "nojudge", string> = {
  uncertain: "text-amber-600 dark:text-amber-400",
  nojudge: "text-muted-foreground",
};

export function GateSuffix({
  census,
}: {
  census: { uncertain: number; noJudge: number };
}) {
  const parts = censusChipSuffixParts(census);
  if (parts.length === 0) return null;
  return (
    <>
      {parts.map((p) => (
        <span key={p.tone} className={TONE[p.tone]}>
          {p.text}
        </span>
      ))}
    </>
  );
}
