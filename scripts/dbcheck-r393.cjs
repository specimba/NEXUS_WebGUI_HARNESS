const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const convs = await p.conversation.findMany({
    orderBy: { updatedAt: "desc" }, take: 3,
    select: { id: true, title: true, heartbeat: true, updatedAt: true, messages: { select: { id: true, role: true, status: true, heartbeat: true, content: true }, take: 12 } },
  });
  for (const c of convs) {
    console.log(JSON.stringify({ id: c.id, title: c.title, hb: c.heartbeat, updatedAt: c.updatedAt, msgs: c.messages.map(m => ({ role: m.role, status: m.status, hb: m.heartbeat, len: (m.content||"").length })) }));
  }
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
