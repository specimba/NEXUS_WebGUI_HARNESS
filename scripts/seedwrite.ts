import { db } from '../src/lib/db';
import { writeFileSync } from 'node:fs';
(async () => {
  const slots = await db.automationVault.findMany();
  const payload = {
    slots: slots.map(s => ({ provider: s.provider, key: s.key, label: s.label ?? undefined })),
  };
  writeFileSync('db/vault-seed.json', JSON.stringify(payload, null, 2) + '\n');
  console.log('seed written with', slots.length, 'slot(s)');
  process.exit(0);
})();
