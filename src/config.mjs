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

const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * Turns the folder settings into one flat list. `account` is '*' for folders that belong to no
 * particular channel, otherwise the key the user wrote (channel id, "profile@provider" or "profile").
 */
export function normalizeFolders(fileConfig, envDirs) {
  const globalExclude = list(fileConfig.exclude);
  const out = [];
  const add = (entry, account) => {
    const o = typeof entry === 'string' ? { path: entry } : entry;
    if (!o?.path) return;
    out.push({
      path: resolve(o.path), account,
      recursive: o.recursive !== false,
      include: list(o.include),
      exclude: [...globalExclude, ...list(o.exclude)],
    });
  };
  envDirs.forEach((d) => add(d, '*'));
  list(fileConfig.folders).forEach((f) => add(f, '*'));
  for (const [account, value] of Object.entries(fileConfig.accounts ?? {})) list(value.folders).forEach((f) => add(f, account));
  return out;
}

export function loadConfig(argv = process.argv.slice(2)) {
  loadDotenv(resolve('.env'));
  const env = (name, fallback) => process.env[name] ?? windowsUserVar(name) ?? fallback;
  const demo = argv.includes('--demo') || env('DEMO') === '1';
  const configPath = resolve(env('CONFIG_PATH', 'lens.config.json'));
  const fileConfig = !demo && existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {};
  const envDirs = (env('LOCAL_MEDIA_DIRS', '') || '').split(delimiter).map((s) => s.trim()).filter(Boolean);
  return {
    demo,
    apiUrl: env('POSTIZ_API_URL', 'https://api.postiz.com'),
    apiKey: env('POSTIZ_API_KEY'),
    folders: demo ? [] : normalizeFolders(fileConfig, envDirs),
    host: env('HOST', '127.0.0.1'),
    port: Number(env('PORT', 4747)),
    dbPath: resolve(env('DB_PATH', demo ? './data/demo.db' : './data/lens.db')),
    syncIntervalMin: Number(env('SYNC_INTERVAL_MIN', 60)),
    syncFromDays: Number(env('SYNC_FROM_DAYS', 365)),
    syncAheadDays: Number(env('SYNC_AHEAD_DAYS', 120)),
    maxStatsPerSync: Number(env('MAX_STATS_PER_SYNC', 80)),
  };
}
