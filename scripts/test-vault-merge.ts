/**
 * r41-c unit tests — provider-vault merge math (pure, no DOM).
 * Run: bun scripts/test-vault-merge.ts
 */
import {
  looksLikeProviderVault,
  looksLikeFullExport,
  mergeProviderKeys,
} from "../src/lib/vault-merge";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("shape detection:");
check("kind marker → vault", looksLikeProviderVault({ kind: "praison-provider-vault" }));
check(
  "providerKeys without arrays → vault",
  looksLikeProviderVault({ providerKeys: { a: { key: "k" } } })
);
check("agents/conversations/workflows arrays → full export", looksLikeFullExport({
  agents: [],
  conversations: [],
  workflows: [],
}));
check("vault is not a full export", !looksLikeFullExport({ kind: "praison-provider-vault" }));
check("garbage is neither", !looksLikeProviderVault(null) && !looksLikeFullExport("x"));
check(
  "providerKeys + agents arrays → still vault-shaped marker wins, full export wins",
  looksLikeFullExport({ agents: [], conversations: [], workflows: [], providerKeys: {} })
);

console.log("merge math:");
const local = {
  vyce: { key: "local-vyce" },
  openrouter: { key: "shared-key", model: "x" },
  pollinations: { key: "" }, // empty local key → fill-empty candidate
};
const incoming = {
  vyce: { key: "vault-vyce", model: "should-not-apply" }, // conflict → local kept
  openrouter: { key: "shared-key" }, // same → same
  pollinations: { key: "vault-poll", model: "m2" }, // fill-empty → added
  groq: { key: "new-groq", accountId: "acc" }, // added
  kilo: { key: "   " }, // skipped (empty)
};

const r = mergeProviderKeys(local, incoming);
check("added = pollinations, groq", r.added.join(",") === "pollinations,groq");
check("same = openrouter", r.same.length === 1 && r.same[0] === "openrouter");
check("conflicts = vyce", r.conflicts.length === 1 && r.conflicts[0] === "vyce");
check("skipped = kilo", r.skipped.length === 1 && r.skipped[0] === "kilo");
check("conflict keeps LOCAL key", r.merged.vyce.key === "local-vyce");
check("conflict does not adopt model hint", r.merged.vyce.model === undefined);
check("fill-empty adopts full entry", r.merged.pollinations.key === "vault-poll" && r.merged.pollinations.model === "m2");
check("new provider adopted with accountId", r.merged.groq.accountId === "acc");
check("same-key tops up missing model", r.merged.openrouter.model === "x");
check("inputs not mutated", local.vyce.key === "local-vyce" && !("groq" in local));

console.log("edge cases:");
const empty = mergeProviderKeys(undefined, incoming);
check(
  "undefined local → 4 added (kilo skipped), 4 merged",
  empty.added.length === 4 && Object.keys(empty.merged).length === 4 && empty.conflicts.length === 0
);
const none = mergeProviderKeys(local, null);
check("null incoming → local untouched, no ops", Object.keys(none.merged).length === 3 && none.added.length === 0);
const junk = mergeProviderKeys(local, { bad: "string-entry", worse: 42 });
check("non-entry values skipped without crash", junk.skipped.length === 0 && !("bad" in junk.merged) && !("worse" in junk.merged));
const trimmed = mergeProviderKeys({ a: { key: "k" } }, { a: { key: "  k  " } });
check("whitespace-padded identical keys count as same", trimmed.same.length === 1 && trimmed.conflicts.length === 0);
const topLevel = mergeProviderKeys({}, { a: { key: "k", model: "m", accountId: "ac", validatedAt: 5 } });
check("full entry shape preserved", topLevel.merged.a.model === "m" && topLevel.merged.a.accountId === "ac" && topLevel.merged.a.validatedAt === 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
