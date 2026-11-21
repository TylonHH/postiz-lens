import { run } from './db.mjs';

// Deterministic synthetic data so the dashboard can be explored (and screenshotted) without a Postiz instance.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (list) => list[Math.floor(rnd() * list.length)];

const ACCOUNTS = [
  { id: 'demo-ig', name: 'Mira Keller | Home Studio', profile: 'mira.makes', provider: 'instagram-standalone', base: 2400 },
  { id: 'demo-tt', name: 'Mira Keller', profile: 'mira.makes', provider: 'tiktok', base: 5200 },
  { id: 'demo-yt', name: 'Mira Makes', profile: '@miramakes', provider: 'youtube', base: 900 },
];
const HOOKS = ['3 desk upgrades under $20', 'The tape trick nobody tells you', 'Rebuilding a thrift-store lamp', 'My 5 minute morning reset',
  'Cable management that actually lasts', 'Paint colors I regret', 'Tiny balcony, big herb garden', 'What a $40 shelf really looks like',
  'Before and after: the hallway', 'Stop buying these organizers', 'Sunday prep in 20 minutes', 'Thrift flip: the ugly chair'];
const TAGS = '#homestudio #diy #makerlife #desksetup';

export function seedDemo(db) {
  db.exec('BEGIN');
  try { seed_(db); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seed_(db) {
  for (const t of ['integrations', 'posts', 'stats', 'files', 'remote_media', 'sync_runs']) db.exec(`DELETE FROM ${t}`);
  seed = 42;
  for (const a of ACCOUNTS) run(db, 'INSERT INTO integrations (id, name, profile, provider, picture, disabled) VALUES (?,?,?,?,NULL,0)', a.id, a.name, a.profile, a.provider);

  const videos = [];
  const clips = [];
  for (let i = 0; i < 46; i++) {
    const title = HOOKS[i % HOOKS.length];
    const sha = `demo-sha-${i}`;
    const folder = ['campaign-spring', 'campaign-desk', 'raw-exports'][i % 3];
    const path = `D:\\Videos\\${folder}\\clip_${String(i + 1).padStart(3, '0')}.mp4`;
    videos.push({ i, title, sha, path });
    run(db, 'INSERT INTO files (path, root, kind, size, mtime, sha256, seen_at) VALUES (?,?,?,?,?,?,?)',
      path, `D:\\Videos\\${folder}`, 'video', 8_000_000 + i * 91_337, Date.now() - i * 86400_000 * 2, sha, new Date().toISOString());
  }

  let n = 0;
  const addPost = (video, account, daysAgo, state, forceViews) => {
    const id = `demo-post-${++n}`;
    const url = `https://demo.invalid/uploads/${id}.mp4`;
    const when = new Date(Date.now() - daysAgo * 86400_000);
    when.setHours(9 + (n % 10), (n * 7) % 60, 0, 0);
    const published = state === 'PUBLISHED';
    run(db, 'INSERT INTO remote_media (url, size, sha256) VALUES (?,?,?)', url, 8_000_000 + video.i * 91_337, video.sha);
    const tails = ['Save this for later.', 'Which one would you try first?', 'Full breakdown in the comments.', 'Tell me what to fix next.'];
    run(db, `INSERT INTO posts (id, group_id, integration_id, state, publish_date, content, release_id, release_url, error, settings, media, comments, detail_at, deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      id, id, account.id, state, when.toISOString(), `${video.title}. ${pick(tails)}\n\n${TAGS}`,
      published ? `r${n}` : null, published ? `https://example.com/p/${id}` : null,
      state === 'ERROR' ? 'Media processing failed on the platform side.' : null, JSON.stringify({ __type: account.provider }),
      JSON.stringify([{ id: `m${n}`, path: url }]),
      JSON.stringify(rnd() > 0.5 ? [{ content: 'Want the full material list? Ask below.', delay: 5 }] : []), new Date().toISOString());
    if (published && rnd() > 0.06) {
      const views = forceViews ?? Math.round(account.base * (0.15 + rnd() ** 3 * 5) * (1 + Math.min(daysAgo, 30) / 40));
      for (let step = 0; step <= Math.min(daysAgo, 5); step++) {
        const at = new Date(when.getTime() + step * 86400_000 + 3600_000).toISOString();
        const k = (step + 1) / (Math.min(daysAgo, 5) + 1);
        const set = { Views: views, Reach: views * 0.82, Likes: views * 0.045, Comments: views * 0.004, Shares: views * 0.006, Saves: views * 0.012 };
        for (const [label, v] of Object.entries(set)) run(db, 'INSERT INTO stats (post_id, taken_at, label, value) VALUES (?,?,?,?)', id, at, label, Math.round(v * k));
      }
    }
    return id;
  };

  videos.forEach((v, idx) => {
    const roll = idx % 11;
    if (idx >= 40) return;                                       // last six files are never posted
    const account = ACCOUNTS[idx % 3];
    const daysAgo = 3 + idx * 1.7;
    if (roll === 4) addPost(v, account, daysAgo, 'PUBLISHED');
    if (roll === 4) addPost(v, account, daysAgo - 9, 'PUBLISHED');  // duplicate on the same account
    else if (roll === 7) addPost(v, account, daysAgo, 'ERROR');
    else if (roll === 9) addPost(v, account, -2 - (idx % 4), 'QUEUE');
    else if (roll === 2) addPost(v, account, daysAgo, 'DRAFT');
    else addPost(v, account, daysAgo, 'PUBLISHED');
    if (roll === 5) addPost(v, ACCOUNTS[(idx + 1) % 3], daysAgo - 1, 'PUBLISHED'); // cross-post
  });
  addPost(videos[0], ACCOUNTS[0], 1, 'QUEUE');                  // queued again although already live
  run(db, 'INSERT INTO sync_runs (started_at, finished_at, ok, summary) VALUES (?,?,?,?)',
    new Date().toISOString(), new Date().toISOString(), 1, JSON.stringify({ demo: true }));
}
