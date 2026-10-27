#!/usr/bin/env node
/**
 * r346 probe — re-land of r339: gallery validate() fresh reads.
 * Pins: (1) validate() reads the entry from useSettingsStore.getState(),
 * NOT the render closure — it may run chained after saveProvider's update;
 * (2) the success path RE-reads getState() after the await gap, so anything
 * that landed in the store while the probe ran survives the validatedAt
 * stamp; (3) honesty guard: a mid-flight key change is kept, stamp skipped;
 * (4) behavioral simulation: closure-spread pattern demonstrably clobbers a
 * mid-await write, fresh-read pattern preserves it; (5) regressions:
 * saveProvider chaining, entry fallback, error path purity, model handler.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

const src = read("src/components/nexus/settings/provider-gallery.tsx");

// ── extract the validate() function body ──
const vStart = src.indexOf("async function validate(p: FreeProvider)");
const vEnd = src.indexOf("\n  }", src.indexOf("setBusy(null)", vStart));
const vBody = vStart > -1 && vEnd > vStart ? src.slice(vStart, vEnd) : "";
ok(vBody.length > 400, "validate() function body extractable (non-trivial span)");

// ── (1) entry read: LIVE store, not the closure ──
ok(/const live = useSettingsStore\.getState\(\)\.settings;/.test(vBody),
  "validate() reads the LIVE store at entry (useSettingsStore.getState())");
ok(/const entry = live\.providerKeys\?\.\[p\.id\] \?\? \{ key: draftKeyFor\(p\)\.trim\(\) \};/.test(vBody),
  "entry derives from the live read, draft fallback intact");
ok(!/const entry = settings\.providerKeys/.test(vBody),
  "closure `settings` no longer sources the entry (the stale-read bug)");

// ── (2) success path: re-read AFTER the await gap ──
const awaitIdx = vBody.indexOf("await runAgentChat");
const freshIdx = vBody.indexOf("useSettingsStore.getState().settings.providerKeys");
ok(awaitIdx > -1, "probe await (runAgentChat) present");
ok(freshIdx > awaitIdx, "success path re-reads getState() AFTER the await gap");
ok(/const freshKeys = useSettingsStore\.getState\(\)\.settings\.providerKeys;/.test(vBody),
  "fresh map captured by name (freshKeys)");
ok(/providerKeys: \{ \.\.\.\(freshKeys \?\? \{\}\), \[p\.id\]: stamp \}/.test(vBody),
  "store write spreads the FRESH map, not the closure map");
ok(!/settings\.providerKeys \?\? \{\}\), \[p\.id\]: \{ \.\.\.entry, key, validatedAt/.test(vBody),
  "the old closure-spread stamp is gone");

// ── (3) honesty guard: mid-flight key change kept, stamp skipped ──
ok(/const storedKey = freshEntry\.key\?\.trim\(\);/.test(vBody), "guard reads the stored key");
ok(/!storedKey \|\| storedKey === key/.test(vBody),
  "stamp applies only when stored key is absent or identical to the probed key");
ok(/validatedAt: Date\.now\(\)/.test(vBody), "validatedAt still stamped on success");

// ── (5) regressions ──
ok(/if \(opts\?\.validateAfter\) void validate\(p\);/.test(src),
  "saveProvider still chains validateAfter → validate");
ok(/update\(\{ providerKeys: \{ \.\.\.\(settings\.providerKeys \?\? \{\}\), \[p\.id\]: next \} \}\);/.test(src),
  "saveProvider's own write shape unchanged (same-tick closure is its intent)");
ok(/if \(!p\.noKey && !key\) \{\s*toast\.error\("Save a key first"\);/.test(vBody),
  "empty-key guard intact");
ok(!/update\(\{/.test(vBody.split("} catch (err)")[1] ?? ""),
  "error path never writes the store (catch block is pure)");
ok(/providerKeys: \{ \.\.\.\(settings\.providerKeys \?\? \{\}\), \[p\.id\]: \{ \.\.\.entry, model: v \} \}/.test(src),
  "model-change handler untouched (per-provider model write)");
ok(/const settings = useSettingsStore\(\(s\) => s\.settings\);/.test(src),
  "component-wide closure selector still present (other call sites rely on it)");

// ── (4) behavioral simulation: closure spread vs fresh re-read ──
function simulate(useFresh) {
  // store: { providerKeys } ; closure: snapshot taken BEFORE saveProvider ran
  let store = { providerKeys: { vyce: { key: "old-key", model: "m1", accountId: "acc-1" } } };
  const closure = structuredClone(store);           // render-time snapshot
  const getState = () => structuredClone(store);
  // saveProvider writes the new key (store moves ahead of the closure)
  store.providerKeys.vyce = { key: "new-key", model: "m1", accountId: "acc-9" };
  // validate(): entry read
  const snapshot = useFresh ? getState() : closure;
  const entry = snapshot.providerKeys.vyce ?? { key: "" };
  const key = entry.key?.trim() || "draft-key";
  // ... await gap: user changes the model mid-probe (line-609 handler)
  store.providerKeys.vyce = { ...store.providerKeys.vyce, model: "m2-changed" };
  // success path: stamp
  const keys = useFresh ? getState().providerKeys : closure.providerKeys;
  const freshEntry = keys.vyce ?? { key };
  const storedKey = freshEntry.key?.trim();
  const stamp = (!storedKey || storedKey === key)
    ? { ...freshEntry, key, validatedAt: 12345 }
    : freshEntry;
  return { ...(keys ?? {}), vyce: stamp };
}

const oldResult = simulate(false);
const newResult = simulate(true);
ok(oldResult.vyce.accountId === "acc-1" || oldResult.vyce.model !== "m2-changed",
  "SIMULATION (old pattern): confirmed BUGGY — closure spread loses mid-await writes");
ok(newResult.vyce.key === "new-key" && newResult.vyce.accountId === "acc-9",
  "SIMULATION (new): chained save's key + accountId survive the await gap");
ok(newResult.vyce.model === "m2-changed" && newResult.vyce.validatedAt === 12345,
  "SIMULATION (new): mid-probe model change survives AND validatedAt lands");
// mid-flight key change → kept, stamp skipped
function simulateKeySwap() {
  let store = { providerKeys: {} };
  const getState = () => structuredClone(store);
  store.providerKeys.vyce = { key: "new-key" };
  const entry = getState().providerKeys.vyce ?? { key: "" };
  const key = entry.key?.trim() || "draft-key";
  store.providerKeys.vyce = { key: "swapped-mid-flight" };
  const keys = getState().providerKeys;
  const freshEntry = keys.vyce ?? { key };
  const storedKey = freshEntry.key?.trim();
  return (!storedKey || storedKey === key)
    ? { ...freshEntry, key, validatedAt: 12345 }
    : freshEntry;
}
const swap = simulateKeySwap();
ok(swap.key === "swapped-mid-flight" && swap.validatedAt === undefined,
  "SIMULATION (guard): mid-flight key swap is KEPT, verdict stamp honestly skipped");

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
