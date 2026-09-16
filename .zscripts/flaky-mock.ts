// QA fixture: flaky OpenAI-compatible mock (default :3031).
// GET /mode?value=flaky2|always502|ok  — switch failure mode (resets counter)
// GET /count                           — how many chat requests received
// POST /v1/chat/completions            — 502s per mode, then healthy SSE
let mode = "flaky2";
let count = 0;
Bun.serve({
  port: 3031,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/mode") {
      mode = url.searchParams.get("value") ?? mode;
      count = 0;
      return new Response(`mode=${mode}`);
    }
    if (url.pathname === "/count") return new Response(String(count));
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      count++;
      if (mode === "always502" || (mode === "flaky2" && count <= 2)) {
        return new Response(JSON.stringify({ error: { message: "network error" } }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        });
      }
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: "" } }] })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `MOCK-OK (served after ${mode === "flaky2" ? count - 2 : count - 1} failures)` } }] })}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log("flaky-mock listening on 3031");
