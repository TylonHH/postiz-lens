import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, resolve } from 'node:path';

function loadDotenv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Windows: user-level variables are not always inherited by already-running shells.
function windowsUserVar(name) {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`))?.[1]?.trim();
  } catch { return undefined; }
}

export function loadConfig(argv = process.argv.slice(2)) {
  loadDotenv(resolve('.env'));
  const env = (name, fallback) => process.env[name] ?? windowsUserVar(name) ?? fallback;
  const demo = argv.includes('--demo') || env('DEMO') === '1';
  return {
    demo,
    apiUrl: env('POSTIZ_API_URL', 'https://api.postiz.com'),
    apiKey: env('POSTIZ_API_KEY'),
    mediaDirs: (env('LOCAL_MEDIA_DIRS', '') || '').split(delimiter).map((s) => s.trim()).filter(Boolean),
    host: env('HOST', '127.0.0.1'),
    port: Number(env('PORT', 4747)),
    dbPath: resolve(env('DB_PATH', demo ? './data/demo.db' : './data/lens.db')),
    syncIntervalMin: Number(env('SYNC_INTERVAL_MIN', 60)),
    syncFromDays: Number(env('SYNC_FROM_DAYS', 365)),
    syncAheadDays: Number(env('SYNC_AHEAD_DAYS', 120)),
    maxStatsPerSync: Number(env('MAX_STATS_PER_SYNC', 80)),
  };
}
