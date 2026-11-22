import { all, one, run } from './db.mjs';
import { resolveHashes, scanLocalFiles } from './files.mjs';

const DAY = 86400_000;
const HOUR = 3600_000;
const parse = (v, fallback) => { try { return typeof v === 'string' ? JSON.parse(v) : v ?? fallback; } catch { return fallback; } };

function snapshotInterval(publishedAt) {
  const age = Date.now() - new Date(publishedAt).getTime();
  return age < 3 * DAY ? 6 * HOUR : age < 30 * DAY ? DAY : 7 * DAY;
}

async function syncIntegrations(ctx) {
  const list = await ctx.client.integrations();
  for (const i of list) {
    run(ctx.db, `INSERT INTO integrations (id, name, profile, provider, picture, disabled) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, profile=excluded.profile, provider=excluded.provider,
      picture=excluded.picture, disabled=excluded.disabled`,
      i.id, i.name, i.profile ?? i.name, i.identifier ?? i.providerIdentifier, i.picture ?? null, i.disabled ? 1 : 0);
  }
  return list.length;
}

async function syncPosts(ctx) {
  const { db, client, cfg } = ctx;
  const from = new Date(Date.now() - cfg.syncFromDays * DAY);
  const to = new Date(Date.now() + cfg.syncAheadDays * DAY);
  const seen = new Set();
  for (let start = from; start < to; start = new Date(start.getTime() + 30 * DAY)) {
    const end = new Date(Math.min(start.getTime() + 30 * DAY, to.getTime()));
    for (const p of await client.posts(start, end)) {
      if (p.parentPostId) continue;
      seen.add(p.id);
      run(db, `INSERT INTO posts (id, group_id, integration_id, state, publish_date, content, release_id, release_url, error, settings, deleted)
        VALUES (?,?,?,?,?,?,?,?,?,?,0)
        ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id, integration_id=excluded.integration_id, state=excluded.state,
        publish_date=excluded.publish_date, content=excluded.content, release_id=excluded.release_id,
        release_url=excluded.release_url, error=excluded.error, settings=excluded.settings, deleted=0`,
        p.id, p.group ?? null, p.integration?.id ?? p.integrationId, p.state, p.publishDate, p.content ?? '',
        p.releaseId ?? null, p.releaseURL ?? null, p.error ?? null,
        typeof p.settings === 'string' ? p.settings : JSON.stringify(p.settings ?? {}));
    }
  }
  // Anything inside the synced window that Postiz no longer returns was deleted there.
  for (const row of all(db, 'SELECT id FROM posts WHERE deleted = 0 AND publish_date >= ? AND publish_date <= ?', from.toISOString(), to.toISOString())) {
    if (!seen.has(row.id)) run(db, 'UPDATE posts SET deleted = 1 WHERE id = ?', row.id);
  }
  return seen.size;
}

async function syncDetails(ctx) {
  const { db, client } = ctx;
  const pending = all(db, `SELECT id, state FROM posts WHERE deleted = 0 AND (detail_at IS NULL OR state IN ('QUEUE','DRAFT'))`);
  let ok = 0;
  for (const { id } of pending) {
    try {
      const group = await client.group(id);
      const main = group.find((p) => p.id === id) ?? group[0];
      const comments = group.filter((p) => p.id !== main.id).map((c) => ({ content: c.content, delay: c.delay ?? 0 }));
      run(ctx.db, 'UPDATE posts SET media = ?, comments = ?, detail_at = ? WHERE id = ?',
        JSON.stringify(parse(main.image, [])), JSON.stringify(comments), new Date().toISOString(), id);
      ok++;
    } catch (e) { ctx.log(`detail failed for ${id}: ${e.message}`); }
  }
  return ok;
}

async function syncStats(ctx) {
  const { db, client, cfg } = ctx;
  const candidates = all(db, `
    SELECT p.id, p.publish_date, (SELECT MAX(taken_at) FROM stats s WHERE s.post_id = p.id) AS last
    FROM posts p WHERE p.deleted = 0 AND p.state = 'PUBLISHED' AND p.release_id IS NOT NULL AND p.release_id != 'missing'`);
  const due = candidates
    .filter((c) => !c.last || Date.now() - new Date(c.last).getTime() >= snapshotInterval(c.publish_date))
    .sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''))
    .slice(0, cfg.maxStatsPerSync);
  let taken = 0;
  for (const c of due) {
    const days = Math.min(90, Math.max(7, Math.ceil((Date.now() - new Date(c.publish_date).getTime()) / DAY) + 2));
    const at = new Date().toISOString();
    try {
      const metrics = await client.postAnalytics(c.id, days);
      // The marker row records the attempt, so posts without metrics are not hammered on every sync.
      run(db, `INSERT OR REPLACE INTO stats (post_id, taken_at, label, value) VALUES (?,?,?,?)`, c.id, at, '_probe', 0);
      for (const m of metrics ?? []) {
        const last = m.data?.[m.data.length - 1];
        if (last) run(db, `INSERT OR REPLACE INTO stats (post_id, taken_at, label, value) VALUES (?,?,?,?)`, c.id, at, m.label, Number(last.total));
      }
      taken++;
    } catch (e) { ctx.log(`stats failed for ${c.id}: ${e.message}`); }
  }
  return taken;
}

async function syncFiles(ctx) {
  const { db, cfg } = ctx;
  const scanned = cfg.folders.length ? await scanLocalFiles(db, cfg.folders) : 0;
  const urls = new Set();
  for (const p of all(db, 'SELECT media FROM posts WHERE deleted = 0 AND media IS NOT NULL')) {
    for (const m of parse(p.media, [])) if (m.path) urls.add(m.path);
  }
  const hashed = await resolveHashes(db, ctx.client, urls, ctx.log);
  return `${scanned} files, ${hashed} hashed`;
}

const state = { running: false, last: null, log: [] };
export const syncStatus = () => ({ running: state.running, last: state.last, log: state.log.slice(-30) });

export async function runSync(cfg, db, client) {
  if (state.running) return state.last;
  state.running = true;
  state.log = [];
  const started = new Date().toISOString();
  const ctx = { cfg, db, client, log: (m) => state.log.push(m) };
  const summary = {};
  let ok = 1;
  for (const [name, step] of [['integrations', syncIntegrations], ['posts', syncPosts], ['details', syncDetails], ['stats', syncStats], ['files', syncFiles]]) {
    try { summary[name] = await step(ctx); }
    catch (e) { ok = 0; summary[name] = `failed: ${e.message}`; ctx.log(`${name} failed: ${e.message}`); }
  }
  const finished = new Date().toISOString();
  run(db, 'INSERT INTO sync_runs (started_at, finished_at, ok, summary) VALUES (?,?,?,?)', started, finished, ok, JSON.stringify(summary));
  state.last = { started, finished, ok: !!ok, summary };
  state.running = false;
  return state.last;
}

export const lastSync = (db) => {
  const r = one(db, 'SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1');
  return r ? { started: r.started_at, finished: r.finished_at, ok: !!r.ok, summary: parse(r.summary, {}) } : null;
};
