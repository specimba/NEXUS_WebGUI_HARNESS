/**
 * r607 witness probe — ENDPOINT-UNREACHABLE rotation doctrine.
 *
 * The parked recursive run dialed Vyce "network error" x3 with zero relay
 * hops while web-search tools succeeded in the SAME run (network up). The
 * fix: pre-response endpoint-unreachable fetch failures throw immediately
 * (hop loop rotates + feeds health memory) instead of burning 2 more
 * same-lane corpse dials. This probe pins the classification contract:
 *
 *  1. unreachable faces -> isEndpointUnreachableError = true (rotate now)
 *  2. flap faces (reset/socket) -> unreachable = false, transient = true
 *     (the cheap same-lane retry is PRESERVED for blips)
 *  3. non-network classes (429 prose, auth, aborts) never match
 *  4. the rotation arm exists in the engine source (bundle-level evidence)
 */
import { readFileSync } from "node:fs";
import {
  isEndpointUnreachableError,
  isTransientNetworkError,
} from "../src/lib/agent-engine";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}`);
  }
}

// 1. endpoint-unreachable faces rotate now
check("fetch failed -> unreachable", isEndpointUnreachableError(new Error("fetch failed")));
check("browser network error -> unreachable", isEndpointUnreachableError(new Error("Error: network error")));
check("Failed to fetch -> unreachable", isEndpointUnreachableError(new TypeError("Failed to fetch")));
check("ENOTFOUND -> unreachable", isEndpointUnreachableError(new Error("getaddrinfo ENOTFOUND api.example.com")));
check("ECONNREFUSED -> unreachable", isEndpointUnreachableError(new Error("connect ECONNREFUSED 127.0.0.1:443")));
check("EAI_AGAIN -> unreachable", isEndpointUnreachableError(new Error("getaddrinfo EAI_AGAIN api.example.com")));
check("load failed -> unreachable", isEndpointUnreachableError(new Error("Load failed")));

// 2. flap class keeps the same-lane retry (reachable-but-reset, blip-shaped)
check("ECONNRESET -> NOT unreachable (flap retry kept)", !isEndpointUnreachableError(new Error("socket hang up? no — ECONNRESET")));
check("ECONNRESET -> still transient", isTransientNetworkError(new Error("ECONNRESET")));
check("socket hang up -> NOT unreachable", !isEndpointUnreachableError(new Error("socket hang up")));
check("socket hang up -> still transient", isTransientNetworkError(new Error("socket hang up")));
check("terminated -> NOT unreachable", !isEndpointUnreachableError(new Error("terminated")));

// 3. non-network classes never match
check("429 prose -> not unreachable", !isEndpointUnreachableError(new Error("HTTP 429 rate limited, slow down")));
check("auth prose -> not unreachable", !isEndpointUnreachableError(new Error("401 unauthorized: check your api key")));
check("abort -> not unreachable", !isEndpointUnreachableError(new DOMException("Aborted", "AbortError")));
check("5xx -> NOT unreachable (reached server, retry kept)", !isEndpointUnreachableError(new Error("HTTP 502 bad gateway")));
check("5xx -> still transient", isTransientNetworkError(new Error("HTTP 502 bad gateway")));

// 4. the rotation arm is live in the engine source
const eng = readFileSync(new URL("../src/lib/agent-engine.ts", import.meta.url), "utf8");
check("rotation arm present in engine", /rotating to the next lane instead of re-dialing/.test(eng));
check("arm sits BEFORE the same-lane retry", eng.indexOf("isEndpointUnreachableError(surfaced)") < eng.indexOf("Upstream hiccup"));
check("r505 silence doctrine intact", /if \(deadlineReason\) throw surfaced;/.test(eng));

if (failures > 0) {
  console.log(`PROBE FAIL — ${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("PROBE PASS — endpoint-unreachable rotation contract pinned (20 assertions)");
