import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, fileStatus } from '../src/analyze.mjs';

const integrations = [
  { id: 'a', name: 'A', profile: 'alpha', provider: 'instagram-standalone' },
  { id: 'b', name: 'B', profile: 'beta', provider: 'tiktok' },
];
const post = (id, integration_id, state, url, content = `caption ${id} `.repeat(6)) => ({
  id, integration_id, state, publish_date: '2026-01-01T10:00:00Z', content, media: JSON.stringify([{ id, path: url }]), release_id: state === 'PUBLISHED' ? 'r' : null,
});
const raw = (posts, extra = {}) => ({
  integrations, posts, files: [], stats: [], remote: [
    { url: 'u1', sha256: 'S1' }, { url: 'u2', sha256: 'S1' }, { url: 'u3', sha256: 'S3' }, { url: 'u4', sha256: 'S1' },
  ], ...extra,
});

test('same file uploaded twice is flagged as duplicate on the same account', () => {
  const m = analyze(raw([post('p1', 'a', 'PUBLISHED', 'u1'), post('p2', 'a', 'QUEUE', 'u2'), post('p3', 'a', 'PUBLISHED', 'u3')]));
  const byId = Object.fromEntries(m.posts.map((p) => [p.id, p]));
  assert.deepEqual(byId.p1.dupOf, ['p2']);
  assert.ok(byId.p2.flags.includes('duplicate'));
  assert.ok(!byId.p3.flags.includes('duplicate'));
});

test('same file on another account is a cross-post, not a duplicate', () => {
  const m = analyze(raw([post('p1', 'a', 'PUBLISHED', 'u1'), post('p2', 'b', 'PUBLISHED', 'u2')]));
  assert.ok(m.posts.every((p) => p.flags.includes('cross-post') && !p.flags.includes('duplicate')));
});

test('failed and draft posts never count as duplicates', () => {
  const m = analyze(raw([post('p1', 'a', 'PUBLISHED', 'u1'), post('p2', 'a', 'ERROR', 'u2'), post('p3', 'a', 'DRAFT', 'u4')]));
  assert.ok(m.posts.every((p) => !p.flags.includes('duplicate')));
});

test('local files are matched by hash and report their status per account', () => {
  const files = [
    { path: '/v/one.mp4', root: '/v', kind: 'video', size: 1, mtime: 1, sha256: 'S1' },
    { path: '/v/two.mp4', root: '/v', kind: 'video', size: 2, mtime: 1, sha256: 'S3' },
    { path: '/v/three.mp4', root: '/v', kind: 'video', size: 3, mtime: 1, sha256: 'S9' },
  ];
  const m = analyze(raw([post('p1', 'a', 'PUBLISHED', 'u1'), post('p2', 'a', 'QUEUE', 'u2'), post('p3', 'b', 'DRAFT', 'u3')], { files }));
  const [one, two, three] = m.files;
  assert.deepEqual(m.posts.find((p) => p.id === 'p1').localFiles, ['/v/one.mp4']);
  assert.equal(fileStatus(one).status, 'published');
  assert.equal(fileStatus(one).uses, 2);
  assert.equal(fileStatus(two).status, 'draft');
  assert.equal(fileStatus(two, 'a').status, 'unposted');
  assert.equal(fileStatus(three).status, 'unposted');
});

test('metrics are normalised from the latest snapshot', () => {
  const stats = [
    { post_id: 'p1', taken_at: '2026-01-02', label: 'Views', value: 10 },
    { post_id: 'p1', taken_at: '2026-01-03', label: 'Views', value: 25 },
    { post_id: 'p1', taken_at: '2026-01-03', label: 'Likes', value: 3 },
  ];
  const [p] = analyze(raw([post('p1', 'a', 'PUBLISHED', 'u1')], { stats })).posts;
  assert.equal(p.metrics.views, 25);
  assert.equal(p.metrics.likes, 3);
  assert.equal(p.metrics.shares, null);
  assert.ok(!p.flags.includes('no-stats'));
});
