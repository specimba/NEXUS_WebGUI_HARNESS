// r656: call-log lane lineage — pure reader logic + source-level wiring pins.
// Run: bun scripts/qa-calllog-lane.ts
import { readFileSync } from "node:fs";
import { laneOfEntry } from "../src/lib/call-log-lane";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL ${name}`);
  }
}
const rel = (p: string) => new URL(p, import.meta.url).pathname;

// ── pure reader logic ──
check("structured lane wins over prose", laneOfEntry({ lane: "server-relay", note: "browser-direct — x" }) === "server-relay");
check("structured direct wins", laneOfEntry({ lane: "browser-direct" }) === "browser-direct");
check("fallback server prefix (pre-r656 row)", laneOfEntry({ note: "server relay — routed through the app's vault chain" }) === "server-relay");
check("fallback direct prefix (pre-r656 row)", laneOfEntry({ note: "browser-direct — key stayed in your browser" }) === "browser-direct");
check("no note no lane -> honest null", laneOfEntry({}) === null);
check("unrelated note (precedent) -> null", laneOfEntry({ note: "Precedent lane — 13 eligible precedents" }) === null);
check("null entry -> null", laneOfEntry(null) === null);
check("undefined entry -> null", laneOfEntry(undefined) === null);
check("junk note type never throws", laneOfEntry({ note: 42 as unknown as string }) === null);

// ── source pins: schema, writer, surface ──
const types = readFileSync(rel("../src/lib/types.ts"), "utf8");
check("schema declares structured lane field", /lane\?\s*:\s*"server-relay"\s*\|\s*"browser-direct"/.test(types));
const runner = readFileSync(rel("../src/lib/workflow-runner.ts"), "utf8");
check("writer stamps browser-direct from transport", runner.includes('lane: "browser-direct" as const'));
check("writer stamps server-relay from transport", runner.includes('lane: "server-relay" as const'));
const panel = readFileSync(rel("../src/components/nexus/workflows/workflow-run-panel.tsx"), "utf8");
check("panel relay chip reads structured lane", panel.includes('laneOfEntry(c) === "server-relay"'));
check("panel direct chip reads structured lane", panel.includes('laneOfEntry(c) === "browser-direct"'));
check("panel imports the shared reader", panel.includes('from "@/lib/call-log-lane"'));

console.log(`qa-calllog-lane: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
