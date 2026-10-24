import { db } from '../src/lib/db';
(async () => {
  for (const m of ['strategyItem','autonomyLog','nextMove','researchQueue','platformSetting','capabilityCheck'] as const) {
    try {
      const anyDb = db as any;
      if (!anyDb[m]) { console.log(m, ': DELEGATE UNDEFINED'); continue; }
      const rows = await anyDb[m].findMany({ take: 1 });
      console.log(m, 'OK rows:', rows.length);
    } catch (e: any) { console.log(m, 'FAIL:', e.message?.slice(0, 200)); }
  }
  process.exit(0);
})();
