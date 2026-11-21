import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { createClient } from './postiz.mjs';
import { runSync, syncStatus } from './sync.mjs';

const cfg = loadConfig();
if (!cfg.apiKey) { console.error('POSTIZ_API_KEY is not set.'); process.exit(1); }
const result = await runSync(cfg, openDb(cfg.dbPath), createClient(cfg));
console.log(JSON.stringify(result, null, 2));
for (const line of syncStatus().log) console.log(' -', line);
process.exit(result.ok ? 0 : 1);
