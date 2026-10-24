import { buildBriefing } from "@/lib/server/strategy";

export const dynamic = "force-dynamic";

// ─── r515-c: the environment brief ───────────────────────────────────────────
// Markdown, text/plain, ungated GET. ANY scheduled agent reads this BEFORE
// acting: the Owner's z.ai crons (paste the URL or the text into the task),
// workflow steps wanting environment awareness, and fresh dev-round sessions.
// This is the "automatedly created prompts understand the task and environment
// properly" piece — no more random agent calls into a vacuum.

export async function GET() {
  try {
    const brief = await buildBriefing();
    return new Response(brief, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(
      `# NEXUS brief — degraded\n\nThe briefing assembly failed honestly: ${e instanceof Error ? e.message : String(e)}\n\nFall back to /home/z/my-project/worklog.md tail + docs/strategy/TASKS.md.\n`,
      {
        status: 500,
        headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" },
      },
    );
  }
}
