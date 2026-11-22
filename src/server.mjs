import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { openDb } from './db.mjs';
import { analyze, fileId, fileStatus, inScope, loadRaw } from './analyze.mjs';
import { createClient } from './postiz.mjs';
import { lastSync, runSync, syncStatus } from './sync.mjs';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const client = cfg.demo || !cfg.apiKey ? null : createClient(cfg);

if (cfg.demo) {
  const { seedDemo } = await import('./demo.mjs');
  seedDemo(db);
} else if (!cfg.apiKey) {
  console.warn('POSTIZ_API_KEY is not set: showing cached data only. See README.');
}

const sum = (list, key) => list.reduce((n, p) => n + (p.metrics[key] ?? 0), 0);
const slim = ({ history, media, ...p }) => ({ ...p, media: media.map((m) => ({ url: m.url, localId: m.files[0] ? fileId(m.files[0].path) : null })) });

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function pickPosts(model, q) {
  const needle = q.get('q')?.toLowerCase();
  return model.posts.filter((p) =>
    (!q.get('account') || p.accountId === q.get('account')) &&
    (!q.get('state') || p.state === q.get('state')) &&
    (!q.get('flag') || p.flags.includes(q.get('flag'))) &&
    (!needle || p.content.toLowerCase().includes(needle) || p.localFiles.some((f) => f.toLowerCase().includes(needle))));
}

function overview(model, q) {
  const posts = model.posts.filter((p) => !q.get('account') || p.accountId === q.get('account'));
  const published = posts.filter((p) => p.state === 'PUBLISHED');
  const byDay = new Map();
  for (const p of published) {
    const day = p.publishDate.slice(0, 10);
    const d = byDay.get(day) ?? { day, posts: 0, views: 0, likes: 0 };
    d.posts++; d.views += p.metrics.views ?? 0; d.likes += p.metrics.likes ?? 0;
    byDay.set(day, d);
  }
  const flagCount = (f) => posts.filter((p) => p.flags.includes(f)).length;
  const account = q.get('account');
  const scoped = model.files.filter((f) => inScope(f, account));
  const fileRows = scoped.map((f) => ({ f, s: fileStatus(f, account) }));
  return {
    totals: {
      posts: posts.length, published: published.length,
      scheduled: posts.filter((p) => p.state === 'QUEUE').length,
      drafts: posts.filter((p) => p.state === 'DRAFT').length,
      views: sum(published, 'views'), reach: sum(published, 'reach'), likes: sum(published, 'likes'),
      comments: sum(published, 'comments'), shares: sum(published, 'shares'), saves: sum(published, 'saves'),
    },
    issues: {
      duplicates: flagCount('duplicate'), sameCaption: flagCount('same-caption'), errors: flagCount('error'),
      noLocalFile: flagCount('no-local-file'), noStats: flagCount('no-stats'),
      unpostedFiles: fileRows.filter((r) => r.s.status === 'unposted').length,
      multiFiles: fileRows.filter((r) => r.s.multi).length,
      localFiles: scoped.length,
    },
    series: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    top: [...published].sort((a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0)).slice(0, 5).map(slim),
  };
}

async function serveFile(req, res, path) {
  let s;
  try { s = await stat(path); } catch { res.writeHead(404).end('Not found'); return; }
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), s.size - 1) : s.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${s.size}`, 'Content-Length': end - start + 1 });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': s.size });
    createReadStream(path).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams;
  try {
    if (url.pathname === '/api/state') {
      const model = analyze(loadRaw(db));
      return json(res, {
        demo: cfg.demo, canSync: !!client, mediaDirs: cfg.folders.length, lastSync: lastSync(db), sync: syncStatus(),
        accounts: model.accounts.map((a) => ({ id: a.id, name: a.name, profile: a.profile, provider: a.provider, picture: a.picture,
          posts: model.posts.filter((p) => p.accountId === a.id).length })).filter((a) => a.posts || !cfg.demo),
      });
    }
    if (url.pathname === '/api/overview') return json(res, overview(analyze(loadRaw(db)), q));
    if (url.pathname === '/api/posts') {
      const model = analyze(loadRaw(db));
      const sort = q.get('sort') ?? 'date';
      const rows = pickPosts(model, q).sort(sort === 'views' ? (a, b) => (b.metrics.views ?? -1) - (a.metrics.views ?? -1)
        : (a, b) => b.publishDate.localeCompare(a.publishDate));
      return json(res, { total: rows.length, posts: rows.slice(0, Number(q.get('limit') ?? 300)).map(slim) });
    }
    const detail = url.pathname.match(/^\/api\/posts\/([\w-]+)$/);
    if (detail) {
      const model = analyze(loadRaw(db));
      const post = model.posts.find((p) => p.id === detail[1]);
      if (!post) return json(res, { error: 'not found' }, 404);
      const related = (ids) => model.posts.filter((p) => ids.includes(p.id)).map(slim);
      return json(res, { ...post, media: post.media.map((m) => ({ url: m.url, files: m.files.map((f) => ({ id: fileId(f.path), path: f.path, size: f.size })) })),
        dupPosts: related(post.dupOf), crossPosts: related(post.crossPost), sameCaptionPosts: related(post.sameCaption) });
    }
    if (url.pathname === '/api/files') {
      const model = analyze(loadRaw(db));
      const account = q.get('account'), status = q.get('status'), needle = q.get('q')?.toLowerCase();
      const rows = model.files.filter((f) => inScope(f, account)).map((f) => ({ ...f, ...fileStatus(f, account) }))
        .filter((f) => (!status || (status === 'multi' ? f.multi : f.status === status)) && (!needle || f.path.toLowerCase().includes(needle)))
        .sort((a, b) => b.mtime - a.mtime);
      return json(res, { total: rows.length, files: rows.slice(0, Number(q.get('limit') ?? 400)) });
    }
    if (url.pathname === '/api/sync') {
      if (req.method === 'POST') {
        if (!client) return json(res, { error: 'Sync unavailable (demo mode or no API key).' }, 400);
        runSync(cfg, db, client);
      }
      return json(res, syncStatus());
    }
    const local = url.pathname.match(/^\/file\/(\w+)$/);
    if (local) {
      const f = analyze(loadRaw(db)).files.find((x) => x.id === local[1]);
      return f ? serveFile(req, res, f.path) : json(res, { error: 'not found' }, 404);
    }

    const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    const target = resolve(join(PUBLIC, rel));
    if (!target.startsWith(resolve(PUBLIC) + sep)) { res.writeHead(403).end(); return; }
    return serveFile(req, res, target);
  } catch (e) {
    console.error(e);
    json(res, { error: e.message }, 500);
  }
});

server.listen(cfg.port, cfg.host, () => {
  console.log(`Postiz Lens running at http://${cfg.host}:${cfg.port}${cfg.demo ? ' (demo data)' : ''}`);
});

if (client) {
  const tick = () => runSync(cfg, db, client).catch((e) => console.error('sync failed:', e.message));
  tick();
  setInterval(tick, cfg.syncIntervalMin * 60_000).unref();
}
