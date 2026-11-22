import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matches } from '../src/glob.mjs';
import { normalizeFolders } from '../src/config.mjs';
import { openDb, all } from '../src/db.mjs';
import { scanLocalFiles } from '../src/files.mjs';
import { accountIdsForKey, analyze, inScope } from '../src/analyze.mjs';

const t = (rel, name = rel.split('/').pop()) => ({ abs: `C:/x/${rel}`, rel, name });

test('glob patterns: names, relative paths and absolute paths', () => {
  assert.ok(matches('build', t('a/build')));
  assert.ok(!matches('build', t('a/builder')));
  assert.ok(matches('**/out/*.mp4', t('c1/out/final.mp4')));
  assert.ok(matches('**/out/*.mp4', t('out/final.mp4')));
  assert.ok(!matches('**/out/*.mp4', t('c1/out/deeper/final.mp4')));
  assert.ok(matches('*.proxy.mp4', t('a/b.proxy.mp4')));
  assert.ok(matches('C:/x/raw', t('raw')));
});

test('scan honours recursive, include and exclude and records the account', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lens-'));
  for (const d of ['top', 'sub/out', 'sub/build', 'sub/raw']) mkdirSync(join(root, d), { recursive: true });
  for (const f of ['top/a.mp4', 'sub/out/b.mp4', 'sub/out/c.txt', 'sub/build/d.mp4', 'sub/raw/e.mp4', 'f.mp4']) writeFileSync(join(root, f), 'x');
  const db = openDb(':memory:');
  const names = () => all(db, 'SELECT path FROM files ORDER BY path').map((r) => r.path.slice(root.length + 1).replace(/\\/g, '/'));

  await scanLocalFiles(db, normalizeFolders({ exclude: ['build'], accounts: { acme: { folders: [{ path: root, exclude: ['raw'] }] } } }, []));
  assert.deepEqual(names(), ['f.mp4', 'sub/out/b.mp4', 'top/a.mp4']);
  assert.deepEqual(all(db, 'SELECT DISTINCT account FROM file_scopes').map((r) => r.account), ['acme']);

  await scanLocalFiles(db, normalizeFolders({ accounts: { acme: { folders: [{ path: root, recursive: false }] } } }, []));
  assert.deepEqual(names(), ['f.mp4']);

  await scanLocalFiles(db, normalizeFolders({ accounts: { acme: { folders: [{ path: root, include: ['**/out/*.mp4'] }] } } }, []));
  assert.deepEqual(names(), ['sub/out/b.mp4']);
});

test('account keys resolve by id, profile and profile@provider', () => {
  const ints = [
    { id: 'i1', name: 'Shop', profile: 'shop', provider: 'instagram-standalone' },
    { id: 'i2', name: 'Shop', profile: 'shop', provider: 'tiktok' },
  ];
  assert.deepEqual(accountIdsForKey('i1', ints), ['i1']);
  assert.deepEqual(accountIdsForKey('@Shop', ints), ['i1', 'i2']);
  assert.deepEqual(accountIdsForKey('shop@tiktok', ints), ['i2']);
});

test('files only show up for the channels whose folders contain them', () => {
  const integrations = [{ id: 'i1', name: 'A', profile: 'a', provider: 'x' }, { id: 'i2', name: 'B', profile: 'b', provider: 'x' }];
  const file = (path) => ({ path, root: '/', kind: 'video', size: 1, mtime: 1, sha256: null });
  const m = analyze({
    integrations, posts: [], remote: [], stats: [],
    files: [file('/a.mp4'), file('/shared.mp4')],
    scopes: [{ path: '/a.mp4', account: 'a' }, { path: '/shared.mp4', account: '*' }],
  });
  const [a, shared] = m.files;
  assert.ok(inScope(a, 'i1') && !inScope(a, 'i2') && inScope(a, ''));
  assert.ok(inScope(shared, 'i1') && inScope(shared, 'i2'));
});
