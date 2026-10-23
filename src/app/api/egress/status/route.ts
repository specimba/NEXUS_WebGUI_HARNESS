import { NextResponse } from "next/server";
import {
  egressTransportName,
  loadEgressPool,
  readRoutingMap,
  summarizePool,
} from "@/lib/server/egress";

export const dynamic = "force-dynamic";

// ─── r514: egress pool status (GET) ──────────────────────────────────────────
// P7: counts / booleans / country codes ONLY — never the token, never proxy
// URLs or credentials. `routing: "on"` = at least one upstream is routed
// through the pool; "off" = everything direct (the default).

export async function GET() {

  const [poolLoad, routing, transport] = await Promise.all([
    loadEgressPool(),
    readRoutingMap(),
    egressTransportName(),
  ]);

  const summary = poolLoad.ok ? summarizePool(poolLoad.pool) : { count: 0, validCount: 0, countries: [] };
  const routingOn = Object.values(routing).some((m) => m === "pool");

  return NextResponse.json({
    ok: true,
    configured: poolLoad.ok,
    count: summary.count,
    validCount: summary.validCount,
    sampledCountries: summary.countries.slice(0, 8),
    routing: routingOn ? "on" : "off",
    transport,
    ...(poolLoad.ok ? {} : { note: poolLoad.message }),
  });
}
