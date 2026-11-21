import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { all, run } from './db.mjs';

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm']);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SKIP_DIRS = new Set(['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']);

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name)); }
    else if (e.isFile()) yield join(dir, e.name);
  }
}

export async function scanLocalFiles(db, dirs) {
  const started = new Date().toISOString();
  const known = new Map(all(db, 'SELECT path, size, mtime FROM files').map((f) => [f.path, f]));
  let count = 0;
  for (const root of dirs) {
    for await (const path of walk(root)) {
      const ext = extname(path).toLowerCase();
      const kind = VIDEO_EXT.has(ext) ? 'video' : IMAGE_EXT.has(ext) ? 'image' : null;
      if (!kind) continue;
      const s = await stat(path);
      const mtime = Math.floor(s.mtimeMs);
      const prev = known.get(path);
      if (prev && prev.size === s.size && prev.mtime === mtime) {
        run(db, 'UPDATE files SET seen_at = ? WHERE path = ?', started, path);
      } else {
        run(db, `INSERT INTO files (path, root, kind, size, mtime, sha256, seen_at) VALUES (?,?,?,?,?,NULL,?)
                 ON CONFLICT(path) DO UPDATE SET root=excluded.root, kind=excluded.kind, size=excluded.size,
                 mtime=excluded.mtime, sha256=NULL, seen_at=excluded.seen_at`, path, root, kind, s.size, mtime, started);
      }
      count++;
    }
  }
  run(db, 'DELETE FROM files WHERE seen_at < ?', started);
  return count;
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export async function sha256Url(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const h = createHash('sha256');
  for await (const chunk of res.body) h.update(chunk);
  return h.digest('hex');
}

/**
 * Hash only what can possibly collide: a file is hashed when another local file or
 * another Postiz upload has exactly the same byte size.
 */
export async function resolveHashes(db, client, urls, log = () => {}) {
  for (const url of urls) {
    if (all(db, 'SELECT 1 FROM remote_media WHERE url = ?', url).length) continue;
    let size = null;
    try { size = await client.head(url); } catch { /* size stays unknown */ }
    run(db, 'INSERT INTO remote_media (url, size, sha256) VALUES (?,?,NULL)', url, size);
  }
  const remoteSizes = new Map();
  for (const m of all(db, 'SELECT size FROM remote_media')) if (m.size) remoteSizes.set(m.size, (remoteSizes.get(m.size) ?? 0) + 1);
  const localSizes = new Set(all(db, 'SELECT size FROM files').map((f) => f.size));

  let hashed = 0;
  const jobs = [
    ...all(db, 'SELECT path, size FROM files WHERE sha256 IS NULL').filter((f) => remoteSizes.has(f.size)).map((f) => async () => {
      try { run(db, 'UPDATE files SET sha256 = ? WHERE path = ?', await sha256File(f.path), f.path); hashed++; }
      catch (e) { log(`hash failed: ${f.path} (${e.message})`); }
    }),
    ...all(db, 'SELECT url, size FROM remote_media WHERE sha256 IS NULL')
      .filter((m) => m.size && ((remoteSizes.get(m.size) ?? 0) > 1 || localSizes.has(m.size))).map((m) => async () => {
        try { run(db, 'UPDATE remote_media SET sha256 = ? WHERE url = ?', await sha256Url(m.url), m.url); hashed++; }
        catch (e) { log(`remote hash failed: ${m.url} (${e.message})`); }
      }),
  ];
  const queue = jobs.values();
  await Promise.all(Array.from({ length: 4 }, async () => { for (const job of queue) await job(); }));
  return hashed;
}
