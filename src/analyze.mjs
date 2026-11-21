import { createHash } from 'node:crypto';
import { all } from './db.mjs';

const parse = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
export const fileId = (path) => createHash('sha1').update(path).digest('hex').slice(0, 12);
const LIVE = new Set(['PUBLISHED', 'QUEUE']);
const METRICS = { views: ['views', 'plays', 'impressions'], reach: ['reach'], likes: ['likes'], comments: ['comments'], shares: ['shares'], saves: ['saves'] };

export function loadRaw(db) {
  return {
    integrations: all(db, 'SELECT * FROM integrations'),
    posts: all(db, 'SELECT * FROM posts WHERE deleted = 0'),
    files: all(db, 'SELECT * FROM files'),
    remote: all(db, 'SELECT * FROM remote_media'),
    stats: all(db, `SELECT * FROM stats WHERE label != '_probe' ORDER BY taken_at`),
  };
}

const normCaption = (s) => s.toLowerCase().replace(/#\S+/g, '').replace(/\W+/gu, ' ').trim();

function pickMetrics(rows) {
  const latest = {};
  for (const r of rows) latest[r.label.toLowerCase()] = r.value;
  const out = {};
  for (const [key, aliases] of Object.entries(METRICS)) {
    const hit = aliases.find((a) => latest[a] !== undefined);
    out[key] = hit ? latest[hit] : null;
  }
  return out;
}

/** Pure function: raw DB rows in, dashboard model out. */
export function analyze(raw) {
  const accounts = new Map(raw.integrations.map((i) => [i.id, i]));
  const remote = new Map(raw.remote.map((m) => [m.url, m]));
  const filesBySha = new Map();
  for (const f of raw.files) {
    if (!f.sha256) continue;
    (filesBySha.get(f.sha256) ?? filesBySha.set(f.sha256, []).get(f.sha256)).push(f);
  }
  const statsByPost = new Map();
  for (const s of raw.stats) (statsByPost.get(s.post_id) ?? statsByPost.set(s.post_id, []).get(s.post_id)).push(s);

  const posts = raw.posts.map((p) => {
    const acc = accounts.get(p.integration_id);
    const media = parse(p.media, []).map((m) => {
      const sha = remote.get(m.path)?.sha256 ?? null;
      return { url: m.path, sha, files: (sha && filesBySha.get(sha)) || [] };
    });
    const rows = statsByPost.get(p.id) ?? [];
    const key = media.length ? media.map((m) => (m.sha ? `sha:${m.sha}` : `url:${m.url}`)).sort().join('|') : null;
    return {
      id: p.id, accountId: p.integration_id, account: acc?.profile ?? acc?.name ?? p.integration_id,
      provider: acc?.provider ?? null, state: p.state, publishDate: p.publish_date, content: p.content,
      releaseUrl: p.release_url, error: p.error, settings: parse(p.settings, {}),
      comments: parse(p.comments, []), media, key, metrics: pickMetrics(rows),
      hasStats: rows.length > 0,
      history: rows.map((r) => ({ at: r.taken_at, label: r.label, value: r.value })),
      localFiles: [...new Set(media.flatMap((m) => m.files.map((f) => f.path)))],
      flags: [], dupOf: [], crossPost: [], sameCaption: [],
    };
  });

  const live = posts.filter((p) => LIVE.has(p.state));
  const group = (list, keyFn) => {
    const map = new Map();
    for (const p of list) { const k = keyFn(p); if (k) (map.get(k) ?? map.set(k, []).get(k)).push(p); }
    return [...map.values()].filter((g) => g.length > 1);
  };
  for (const g of group(live, (p) => p.key && `${p.accountId}|${p.key}`)) {
    for (const p of g) { p.flags.push('duplicate'); p.dupOf = g.filter((o) => o !== p).map((o) => o.id); }
  }
  for (const g of group(live, (p) => p.key)) {
    const accountsInGroup = new Set(g.map((p) => p.accountId));
    if (accountsInGroup.size > 1) for (const p of g) { p.flags.push('cross-post'); p.crossPost = g.filter((o) => o.accountId !== p.accountId).map((o) => o.id); }
  }
  for (const g of group(live, (p) => { const c = normCaption(p.content); return c.length >= 30 ? `${p.accountId}|${c}` : null; })) {
    for (const p of g) if (!p.flags.includes('duplicate')) { p.flags.push('same-caption'); p.sameCaption = g.filter((o) => o !== p).map((o) => o.id); }
  }
  for (const p of posts) {
    if (p.state === 'ERROR') p.flags.push('error');
    if (p.state === 'PUBLISHED' && !p.hasStats) p.flags.push('no-stats');
    if (p.media.length && !p.localFiles.length) p.flags.push('no-local-file');
  }

  const files = raw.files.map((f) => ({
    id: fileId(f.path), path: f.path, root: f.root, kind: f.kind, size: f.size, mtime: f.mtime,
    posts: f.sha256 ? posts.filter((p) => p.media.some((m) => m.sha === f.sha256)) : [],
  }));
  return { accounts: [...accounts.values()], posts, files };
}

/** Per-account view of the file library: status depends on where the file was posted. */
export function fileStatus(file, accountId) {
  const posts = file.posts.filter((p) => !accountId || p.accountId === accountId);
  const count = (s) => posts.filter((p) => p.state === s).length;
  const uses = count('PUBLISHED') + count('QUEUE');
  const status = count('PUBLISHED') ? 'published' : count('QUEUE') ? 'scheduled' : count('ERROR') ? 'error' : count('DRAFT') ? 'draft' : 'unposted';
  return { status, uses, multi: uses > 1, posts: posts.map((p) => ({ id: p.id, state: p.state, account: p.account, publishDate: p.publishDate })) };
}
