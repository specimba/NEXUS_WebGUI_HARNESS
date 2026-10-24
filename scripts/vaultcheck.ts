import { db } from '../src/lib/db';
(async () => {
  const slots = await db.automationVault.findMany();
  for (const s of slots) {
    const k = s.key || '';
    console.log(`provider=${s.provider} label=${s.label ?? '-'} key=${k.slice(0,5)}...${k.slice(-4)} len=${k.length}`);
  }
  process.exit(0);
})();
