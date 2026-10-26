/**
 * QA r580 — harness-adapter contract: the reference retrieval adapter through
 * the registry, against fixtures. Acceptance for the TASKS.md P2 row
 * "Harness-agnostic lane-adapter spec (HarnessRouter)": spec doc + one
 * reference adapter passing a fixture test. Dial-free (pure module + fixtures).
 *
 * Doctrine: exit code rides a variable; process.exit runs AFTER try/finally.
 */
import {
  createHarnessRegistry,
  createLaneAdapter,
  createRetrievalAdapter,
  type RetrievalResult,
} from "../src/lib/harness-adapter";

let exitCode = 1;
try {
  // Fixture corpus — small, anchored, deterministic (the capability under test
  // is the adapter CONTRACT; the ranking math has its own r579 acceptance).
  const corpus = [
    { id: "d1", label: "bun.sh", text: "Bun — a fast all-in-one JavaScript runtime, bundler, test runner and npm-compatible package manager." },
    { id: "d2", label: "nextjs.org", text: "Next.js by Vercel — the full-stack React framework for the web with app router and components." },
    { id: "d3", label: "ui.shadcn.com", text: "shadcn/ui — composable, accessible components with thoughtful defaults; the foundation for your design system." },
    { id: "d4", label: "fixture-cron", text: "Cron patrol budget discipline: every round reads the worklog tail first and keeps console clean." },
  ];
  const registry = createHarnessRegistry([createRetrievalAdapter(corpus)]);

  let failed = 0;
  const check = (name: string, cond: boolean): void => {
    console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
    if (!cond) failed += 1;
  };

  // 1. Happy path — contract shape end to end.
  const ok1 = await registry.execute({
    harness: "probe-router",
    lane: "retrieval",
    capability: "retrieval.hybrid",
    payload: { query: "fast javascript runtime bundler", topN: 3 },
  });
  check("R-shape: ok=true with result/lane/provenance and no error", ok1.ok === true && ok1.result !== undefined && ok1.error === undefined);
  check("R2 provenance: 'harness-adapter:probe-router/retrieval' on every response", ok1.provenance === "harness-adapter:probe-router/retrieval");
  check("lane echo", ok1.lane === "retrieval");
  const hits = (ok1.result as RetrievalResult).hits;
  check("capability works: 'fast javascript runtime bundler' → bun.sh wins the fuse", hits[0]?.id === "bun.sh");

  // 2. Determinism.
  const ok1b = await registry.execute({
    harness: "probe-router",
    lane: "retrieval",
    capability: "retrieval.hybrid",
    payload: { query: "fast javascript runtime bundler", topN: 3 },
  });
  check("determinism: identical request → identical hits", JSON.stringify((ok1b.result as RetrievalResult).hits) === JSON.stringify(hits));

  // 3. R3 — unsupported capability is an error, not a silent best-effort.
  const ok3 = await registry.execute({
    harness: "probe-router",
    lane: "retrieval",
    capability: "llm.dial",
    payload: { prompt: "hi" },
  });
  check("R3: unsupported capability → CAPABILITY_UNSUPPORTED, ok=false", ok3.ok === false && ok3.error?.code === "CAPABILITY_UNSUPPORTED");
  check("R2 holds on error paths too", ok3.provenance === "harness-adapter:probe-router/retrieval");

  // 4. Unknown lane → ADAPTER_NOT_FOUND (provenance names the miss).
  const ok4 = await registry.execute({
    harness: "probe-router",
    lane: "warp",
    capability: "anything",
    payload: {},
  });
  check("unknown lane → ADAPTER_NOT_FOUND with '…/none' provenance", ok4.ok === false && ok4.error?.code === "ADAPTER_NOT_FOUND" && ok4.provenance === "harness-adapter:probe-router/none");

  // 5. R5 — payload cap.
  const tiny = createHarnessRegistry([
    createLaneAdapter({
      id: "echo",
      lanes: ["utility"],
      capabilities: ["echo"],
      payloadCap: 10,
      execute: async () => ({ ok: true, result: "echo" }),
    }),
  ]);
  const ok5 = await tiny.execute({ harness: "probe", lane: "utility", capability: "echo", payload: "x".repeat(11) });
  check("R5: payload over cap → PAYLOAD_TOO_LARGE", ok5.ok === false && ok5.error?.code === "PAYLOAD_TOO_LARGE");

  // 6. R1 — a throwing adapter becomes an error envelope, never an exception.
  const boom = createHarnessRegistry([
    createLaneAdapter({
      id: "boom",
      lanes: ["boom"],
      capabilities: ["explode"],
      execute: async () => {
        throw new Error("adapter exploded");
      },
    }),
  ]);
  const ok6 = await boom.execute({ harness: "probe", lane: "boom", capability: "explode", payload: {} });
  check("R1: throwing adapter → ADAPTER_FAILURE envelope (no exception escaped)", ok6.ok === false && ok6.error?.code === "ADAPTER_FAILURE" && ok6.error.message === "adapter exploded");

  // 7. R6 — timeout budget enforced by the registry.
  const slow = createHarnessRegistry([
    createLaneAdapter({
      id: "slow",
      lanes: ["slow"],
      capabilities: ["stall"],
      timeoutMs: 30,
      execute: () => new Promise(() => undefined), // never resolves
    }),
  ]);
  const ok7 = await slow.execute({ harness: "probe", lane: "slow", capability: "stall", payload: {} });
  check("R6: stalled adapter → TIMEOUT within its 30ms budget", ok7.ok === false && ok7.error?.code === "TIMEOUT");

  // 8. INVALID_PAYLOAD (adapter-level code flows through the envelope).
  const ok8 = await registry.execute({
    harness: "probe-router",
    lane: "retrieval",
    capability: "retrieval.hybrid",
    payload: { query: "" },
  });
  check("empty query → INVALID_PAYLOAD envelope", ok8.ok === false && ok8.error?.code === "INVALID_PAYLOAD");

  // 9. registry.list() shape (introspection for foreign harnesses).
  const listed = registry.list();
  check("list(): one adapter, lanes+capabilities+budgets exposed", listed.length === 1 && listed[0].id === "retrieval" && listed[0].capabilities[0] === "retrieval.hybrid" && listed[0].payloadCap > 0);

  console.log(`\nharness-adapter-qa: ${failed === 0 ? "ALL PASS" : `${failed} FAILURES`}`);
  exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error("harness-adapter-qa ERROR (registry must never throw — this catch is the test's own guard):", err instanceof Error ? err.message : String(err));
} finally {
  console.log("fixture registry dropped (no shared state mutated)");
}
process.exit(exitCode);
