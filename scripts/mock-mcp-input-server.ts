// @ts-nocheck
/**
 * r40 QA mock — a tiny stateless MCP server that SPEAKS MRTR.
 * Run: bun scripts/mock-mcp-input-server.ts   (listens on :8787)
 *
 * tools/list  → one tool: confirm_deploy
 * tools/call  → round 1 (no inputResponses): InputRequiredResult
 *                 { resultType: "input_required",
 *                   inputRequests: [{ id: "q1", type: "text", message: "Which environment should I deploy to?" }] }
 *               round 2 (inputResponses present): complete result echoing the answer.
 * CORS-open (access-control-allow-origin: *) so the browser-direct transport
 * can reach it — the exact doctrine the r38 client implements.
 */
const PORT = 8787;

const PROTO_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"];

function cors(headers: Record<string, string>): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, mcp-protocol-version, authorization",
    "Access-Control-Expose-Headers": "mcp-protocol-version",
    ...headers,
  };
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors({}) });
    }
    if (req.method !== "POST" || !new URL(req.url).pathname.startsWith("/mcp")) {
      return new Response("POST /mcp only", { status: 404 });
    }
    const body = (await req.json()) as { id: unknown; method: string; params?: Record<string, unknown> };
    const version = req.headers.get("mcp-protocol-version") ?? "2025-11-25";

    if (body.method === "tools/list") {
      return json(body.id, {
        tools: [
          {
            name: "confirm_deploy",
            description:
              "Deploy the PraisonAI mock service. Asks the operator which environment to target before deploying.",
            inputSchema: { type: "object", properties: { service: { type: "string", description: "service name" } } },
          },
        ],
      }, version);
    }
    if (body.method === "tools/call") {
      const params = (body.params ?? {}) as { name?: string; inputResponses?: unknown };
      if (params.name !== "confirm_deploy") {
        return json(body.id, { isError: true, resultType: "complete", content: [{ type: "text", text: `unknown tool ${params.name}` }] }, version);
      }
      const answered = Array.isArray(params.inputResponses) && params.inputResponses.length > 0;
      if (!answered) {
        // ── round 1: the MRTR InputRequiredResult ──────────────────────────
        return json(body.id, {
          resultType: "input_required",
          inputRequests: [
            { id: "q1", type: "text", message: "Which environment should I deploy to? (staging | production)" },
          ],
        }, version);
      }
      // ── round 2: the retry with inputResponses ───────────────────────────
      const first = (params.inputResponses as { id?: string; value?: string }[])[0];
      return json(body.id, {
        resultType: "complete",
        content: [{ type: "text", text: `Deployed to ${first?.value ?? "(blank)"} — mock service healthy.` }],
      }, version);
    }
    return json(body.id, { error: { code: -32601, message: `method ${body.method} not found` } }, version);
  },
});

function json(id: unknown, result: Record<string, unknown>, version: string): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: cors({ "Content-Type": "application/json", "mcp-protocol-version": version }),
  });
}

console.log(`mock MRTR MCP server on http://localhost:${PORT}/mcp`);
console.log(`(protocol versions accepted: ${PROTO_VERSIONS.join(", ")})`);
