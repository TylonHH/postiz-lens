const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n == null ? '–' : new Intl.NumberFormat('en', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n));
const date = (d) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const day = (d) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(d));
const bytes = (n) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const ago = (d) => { const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const gradient = (id) => `linear-gradient(135deg, hsl(${hue(id)} 65% 46%), hsl(${(hue(id) + 70) % 360} 70% 32%))`;
const isVideo = (u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u ?? '');
const NET = { 'instagram-standalone': ['IG', '#e1306c'], instagram: ['IG', '#e1306c'], tiktok: ['TT', '#111'], youtube: ['YT', '#ff0033'], threads: ['Th', '#444'],
  facebook: ['FB', '#1877f2'], pinterest: ['Pi', '#e60023'], x: ['X', '#222'], linkedin: ['in', '#0a66c2'], bluesky: ['Bs', '#1185fe'] };
const net = (p) => NET[p] ?? [(p ?? '?').slice(0, 2), '#555'];
const STATE = { PUBLISHED: 'Published', QUEUE: 'Scheduled', DRAFT: 'Draft', ERROR: 'Error' };
const FLAG = { duplicate: 'Duplicate', 'same-caption': 'Same caption', 'cross-post': 'Cross-post', 'no-local-file': 'No local file', 'no-stats': 'No stats', error: 'Error' };

const api = (path) => fetch(path).then((r) => r.json());
let app = { accounts: [], demo: false };
let drawerId = null;

function route() {
  const [path, query = ''] = location.hash.slice(2).split('?');
  return { page: path || 'overview', q: new URLSearchParams(query) };
}
const link = (page, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return `#/${page}${q.size ? `?${q}` : ''}`;
};

/* ---------- shell ---------- */
function avatar(a, size) {
  const [label, color] = net(a.provider);
  const bg = a.picture ? `background-image:url('${esc(a.picture)}')` : '';
  return `<span class="avatar" style="${bg};${size ? `width:${size}px;height:${size}px` : ''}">${a.picture ? '' : esc((a.profile || a.name || '?')[0].toUpperCase())}<i class="net" style="background:${color}">${esc(label)}</i></span>`;
}

function renderShell({ page, q }) {
  const current = q.get('account') ?? '';
  const total = app.accounts.reduce((n, a) => n + a.posts, 0);
  $('#accounts').innerHTML =
    `<a class="acct ${current ? '' : 'on'}" href="${link(page)}"><span class="avatar">∑</span><span class="meta"><b>All accounts</b><span>${app.accounts.length} connected</span></span><span class="count">${total}</span></a>` +
    app.accounts.map((a) => `<a class="acct ${current === a.id ? 'on' : ''}" href="${link(page, { account: a.id })}">${avatar(a)}<span class="meta"><b>${esc(a.name)}</b><span>@${esc(String(a.profile).replace(/^@/, ''))}</span></span><span class="count">${a.posts}</span></a>`).join('');
  $('#tabs').innerHTML = ['overview', 'posts', 'files'].map((p) =>
    `<a class="${p === page ? 'on' : ''}" href="${link(p, { account: current })}">${p[0].toUpperCase() + p.slice(1)}</a>`).join('');
  const s = app.sync, last = s?.last ?? app.lastSync;
  $('#syncbox').innerHTML = `
    <div class="row"><span>${s?.running ? '<i class="dot run"></i>Syncing…' : last ? `<i class="dot ${last.ok ? '' : 'bad'}"></i>Synced ${ago(last.finished)}` : 'Never synced'}</span>
      ${app.canSync ? `<button class="btn" id="syncnow" ${s?.running ? 'disabled' : ''}>Sync now</button>` : ''}</div>
    ${app.demo ? '<div><span class="demo-pill">DEMO</span> Synthetic data</div>' : ''}
    ${!app.canSync && !app.demo ? '<div>No API key. Showing cached data.</div>' : ''}
    ${!app.demo && !app.mediaDirs ? '<div>Set <code>LOCAL_MEDIA_DIRS</code> to link local files.</div>' : ''}`;
  $('#syncnow')?.addEventListener('click', async () => { await fetch('/api/sync', { method: 'POST' }); poll(); });
  const input = $('#search');
  input.hidden = page === 'overview';
  if (document.activeElement !== input) input.value = q.get('q') ?? '';
}

/* ---------- shared bits ---------- */
function thumb(p, big) {
  const m = p.media?.[0];
  const label = esc(p.content.split(/[.!?\n]/)[0].slice(0, 60));
  const media = m && isVideo(m.url) ? `<video muted playsinline preload="none" data-src="${esc(m.url)}" data-alt="${m.localId ? `/file/${m.localId}` : ''}"></video>`
    : m ? `<img loading="lazy" src="${esc(m.url)}" alt="" onload="this.nextElementSibling?.remove()">` : '';
  return `${media}<div class="ph">${label}</div>`;
}

function lazyVideos(root) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const v = e.target;
    const ph = v.nextElementSibling;
    v.addEventListener('loadeddata', () => ph?.remove(), { once: true });
    v.addEventListener('error', () => { if (v.dataset.alt && v.src !== location.origin + v.dataset.alt) v.src = v.dataset.alt; }, { once: false });
    v.preload = 'metadata';
    v.src = `${v.dataset.src}#t=0.1`;
  }), { rootMargin: '300px' });
  root.querySelectorAll('video[data-src]').forEach((v) => io.observe(v));
}

const chips = (items, active, make) => items.map(([value, label, cls = '']) =>
  `<a class="chip ${cls} ${active === value ? 'on' : ''}" href="${make(value)}">${label}</a>`).join('');

/* ---------- overview ---------- */
let seriesMetric = 'views', noMetrics = false, autoPosts = false;
async function overview({ q }) {
  const account = q.get('account') ?? '';
  const d = await api(`/api/overview?account=${account}`);
  const t = d.totals, i = d.issues;
  const hasViews = d.series.some((s) => s.views > 0);
  noMetrics = !hasViews;
  if (!hasViews && seriesMetric !== 'posts') seriesMetric = 'posts';
  else if (hasViews && seriesMetric === 'posts' && autoPosts) seriesMetric = 'views';
  autoPosts = !hasViews;
  const kpi = (v, l, hero) => `<div class="card kpi ${hero ? 'hero' : ''}"><div class="v">${num(v)}</div><div class="l">${l}</div></div>`;
  const issue = (n, title, hint, href, level) =>
    `<a class="card issue ${n === 0 ? 'zero' : level}" href="${href}"><span class="n">${n}</span><span><b>${title}</b><span>${hint}</span></span></a>`;
  const A = (extra) => link('posts', { account, ...extra });
  $('#view').innerHTML = `
    <h1>Overview</h1><p class="sub">${esc(account ? app.accounts.find((a) => a.id === account)?.name ?? '' : 'All connected accounts')}</p>
    <div class="kpis">${kpi(t.views, 'Views (published)', true)}${kpi(t.reach, 'Reach')}${kpi(t.likes, 'Likes')}${kpi(t.published, 'Published posts')}${kpi(t.scheduled, 'Scheduled')}${kpi(t.drafts, 'Drafts')}</div>
    <div class="attention">
      ${issue(i.duplicates, 'Posted more than once', 'Same video file, same account', A({ flag: 'duplicate' }), 'warn')}
      ${issue(i.unpostedFiles, 'Local files never posted', `of ${i.localFiles} indexed files`, link('files', { account, status: 'unposted' }), 'warn')}
      ${issue(i.errors, 'Failed posts', 'Platform rejected or publish failed', A({ state: 'ERROR' }), 'bad')}
      ${issue(i.noLocalFile, 'Posts without local file', 'Source not found in your folders', A({ flag: 'no-local-file' }), 'warn')}
      ${issue(i.sameCaption, 'Reused captions', 'Different video, same text', A({ flag: 'same-caption' }), 'warn')}
      ${issue(i.noStats, 'Published without stats', 'Postiz returned no metrics (new post or channel lacks insights access)', A({ flag: 'no-stats' }), 'warn')}
    </div>
    <div class="card chartcard">
      <h3>Performance by publish day
        <span class="toggle">${['views', 'likes', 'posts'].map((m) => `<button data-m="${m}" class="${m === seriesMetric ? 'on' : ''}">${m}</button>`).join('')}</span>
        <span class="toggle right">${[[30, '30 d'], [90, '90 d'], [0, 'All']].map(([r, l]) => `<button data-r="${r}" class="${r === seriesRange ? 'on' : ''}">${l}</button>`).join('')}</span></h3>
      ${noMetrics ? '<p class="note">Postiz returned no views or likes for this selection, so the chart shows posts per day. The platform connection may lack insights access.</p>' : ''}
      <div id="chart"></div>
    </div>
    <div class="card"><h3>Top videos</h3><div class="toplist">${d.top.length ? d.top.map((p, n) =>
      `<div class="toprow" data-post="${p.id}"><span class="rank">${n + 1}</span><span class="t">${esc(p.content.split('\n')[0])}</span><span class="vv">${num(p.metrics.views)}</span></div>`).join('') : '<div class="empty">No stats yet</div>'}</div></div>`;
  seriesData = d.series;
  drawChart();
  document.querySelectorAll('.toggle button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.m) seriesMetric = b.dataset.m; else seriesRange = Number(b.dataset.r);
    document.querySelectorAll('.toggle button').forEach((x) => x.classList.toggle('on', x.dataset.m ? x.dataset.m === seriesMetric : Number(x.dataset.r) === seriesRange));
    drawChart();
  }));
}

let seriesData = [], seriesRange = 90;
window.addEventListener('resize', () => drawChart());

function drawChart() {
  const el = $('#chart');
  if (!el) return;
  const cutoff = seriesRange ? new Date(Date.now() - seriesRange * 86400_000).toISOString().slice(0, 10) : '';
  const data = seriesData.filter((d) => d.day >= cutoff);
  if (!data.length) { el.innerHTML = '<div class="empty">No published posts in this range</div>'; return; }
  const W = Math.max(320, el.clientWidth), H = 340, left = 46, right = 12, top = 12, bottom = 28;
  const rawMax = Math.max(1, ...data.map((d) => d[seriesMetric]));
  const unit = 10 ** Math.floor(Math.log10(rawMax / 4)), f = rawMax / 4 / unit;
  const stepSize = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * unit);
  const max = stepSize * Math.ceil(rawMax / stepSize);
  const step = (W - left - right) / data.length;
  const bw = Math.min(34, Math.max(3, step * 0.72));
  const y = (v) => top + (1 - v / max) * (H - top - bottom);
  const grid = Array.from({ length: Math.round(max / stepSize) + 1 }, (_, n) => n * stepSize).map((v) =>
    `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${left - 8}" y="${y(v) + 3}" text-anchor="end">${num(v)}</text>`).join('');
  const bars = data.map((d, n) => {
    const x = left + n * step + (step - bw) / 2;
    const h = Math.max(2, (H - top - bottom) * (d[seriesMetric] / max));
    return `<rect class="bar" x="${x}" y="${H - bottom - h}" width="${bw}" height="${h}" rx="${Math.min(5, bw / 2)}"><title>${day(d.day)}: ${num(d[seriesMetric])} ${seriesMetric} · ${d.posts} post${d.posts > 1 ? 's' : ''}</title></rect>`;
  }).join('');
  const every = Math.ceil(data.length / Math.max(2, Math.floor((W - left) / 80)));
  const labels = data.map((d, n) => (n % every ? '' : `<text x="${left + n * step + step / 2}" y="${H - 8}" text-anchor="middle">${day(d.day)}</text>`)).join('');
  el.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>${grid}${bars}${labels}</svg>`;
}

/* ---------- posts ---------- */
async function posts({ q }) {
  const params = Object.fromEntries(['account', 'state', 'flag', 'sort', 'q'].map((k) => [k, q.get(k) ?? '']));
  const d = await api(`/api/posts?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`);
  const make = (key) => (value) => link('posts', { ...params, [key]: params[key] === value ? '' : value });
  $('#view').innerHTML = `
    <h1>Posts</h1><p class="sub">Every post Postiz knows about, with the local files behind it.</p>
    <div class="filters">
      ${chips([['', 'All'], ...Object.entries(STATE)], params.state, (v) => link('posts', { ...params, state: v }))}<span class="sep"></span>
      ${chips([['duplicate', 'Duplicates', 'warn'], ['same-caption', 'Same caption', 'warn'], ['cross-post', 'Cross-posts'], ['no-local-file', 'No local file'], ['no-stats', 'No stats']], params.flag, make('flag'))}<span class="sep"></span>
      ${chips([['views', 'Top views']], params.sort, make('sort'))}
      <span class="count-line">${d.total} post${d.total === 1 ? '' : 's'}</span>
    </div>
    ${d.posts.length ? `<div class="posts">${d.posts.map(card).join('')}</div>` : '<div class="empty">Nothing matches these filters.</div>'}`;
  lazyVideos($('#view'));
}

function card(p) {
  const badges = [`<span class="badge s-${p.state}">${STATE[p.state] ?? p.state}</span>`, ...p.flags.filter((f) => f !== 'error').map((f) => `<span class="badge f-${f}">${FLAG[f] ?? f}</span>`)].join('');
  return `<article class="post" data-post="${p.id}">
    <div class="thumb" style="--g:${gradient(p.id)}">${thumb(p)}<div class="badges">${badges}</div>
      ${p.state === 'PUBLISHED' ? `<div class="views">${num(p.metrics.views)}<small>views</small></div>` : ''}</div>
    <div class="body"><div class="when"><span>${date(p.publishDate)}</span><span>@${esc(String(p.account).replace(/^@/, ''))}</span></div>
      <div class="cap">${esc(p.content)}</div>
      ${p.state === 'PUBLISHED' ? `<div class="mets"><span>♥ <b>${num(p.metrics.likes)}</b></span><span>💬 <b>${num(p.metrics.comments)}</b></span><span>↗ <b>${num(p.metrics.shares)}</b></span><span>⚑ <b>${num(p.metrics.saves)}</b></span></div>` : ''}
    </div></article>`;
}

/* ---------- files ---------- */
async function files({ q }) {
  const params = Object.fromEntries(['account', 'status', 'q'].map((k) => [k, q.get(k) ?? '']));
  const d = await api(`/api/files?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`);
  const label = { published: 'Published', scheduled: 'Scheduled', draft: 'Draft only', error: 'Failed only', unposted: 'Never posted', multi: 'Used 2+ times' };
  $('#view').innerHTML = `
    <h1>Local files</h1><p class="sub">Videos and images found in your configured folders, matched to Postiz uploads by content hash.</p>
    <div class="filters">${chips([['', 'All'], ...Object.entries(label).map(([k, v]) => [k, v, k === 'unposted' || k === 'multi' ? 'warn' : ''])], params.status, (v) => link('files', { ...params, status: v }))}
      <span class="count-line">${d.total} file${d.total === 1 ? '' : 's'}</span></div>
    ${d.files.length ? `<div class="card" style="padding:6px 10px"><table><thead><tr><th>File</th><th>Size</th><th>Modified</th><th>Status</th><th>Posted as</th></tr></thead><tbody>${d.files.map((f) => {
      const cut = Math.max(f.path.lastIndexOf('\\'), f.path.lastIndexOf('/'));
      return `<tr><td class="path"><span class="dir">${esc(f.path.slice(0, cut))}</span><b><a href="/file/${f.id}" target="_blank">${esc(f.path.slice(cut + 1))}</a></b></td>
        <td>${bytes(f.size)}</td><td>${day(f.mtime)}</td>
        <td><span class="badge s-${f.status}">${label[f.status]}</span>${f.multi ? ` <span class="badge f-multi">${f.uses}×</span>` : ''}</td>
        <td>${f.posts.map((p) => `<a class="plink" data-post="${p.id}">${esc(p.account)} · ${day(p.publishDate)} · ${STATE[p.state]}</a>`).join('') || '–'}</td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty">${app.mediaDirs || app.demo ? 'No files match.' : 'No local folders configured. Set <code>LOCAL_MEDIA_DIRS</code> in your .env file.'}</div>`}`;
}

/* ---------- drawer ---------- */
async function openDrawer(id) {
  drawerId = id;
  const p = await api(`/api/posts/${id}`);
  const m = p.media[0];
  const local = m?.files[0];
  const player = m && isVideo(m.url)
    ? `<video controls playsinline preload="metadata" src="${esc(m.url)}" ${local ? `onerror="this.onerror=null;this.src='/file/${local.id}'"` : ''}></video>`
    : `<div class="vph" style="--g:${gradient(p.id)}">${m ? 'Image post' : 'No media'}</div>`;
  const hist = p.history.filter((h) => h.label.toLowerCase() === 'views');
  const list = (title, arr) => arr.length ? `<h4>${title}</h4>${arr.map((o) => `<a class="plink" data-post="${o.id}">${esc(o.account)} · ${date(o.publishDate)} · ${STATE[o.state]}</a>`).join('')}` : '';
  const mets = [['Views', 'views'], ['Reach', 'reach'], ['Likes', 'likes'], ['Comments', 'comments'], ['Shares', 'shares'], ['Saves', 'saves']];
  $('#drawer').hidden = false;
  $('#drawer').innerHTML = `<button class="x" aria-label="Close">✕</button>${player}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="badge s-${p.state}" style="position:static">${STATE[p.state]}</span>
      ${p.flags.map((f) => `<span class="badge f-${f}" style="position:static">${FLAG[f] ?? f}</span>`).join('')}
      <span style="color:var(--muted)">${date(p.publishDate)} · @${esc(String(p.account).replace(/^@/, ''))}</span></div>
    ${p.releaseUrl ? `<p><a class="plink" href="${esc(p.releaseUrl)}" target="_blank" rel="noopener">Open on platform ↗</a></p>` : ''}
    ${p.error ? `<div class="warnbox">${esc(p.error)}</div>` : ''}
    ${p.state === 'PUBLISHED' ? `<h4>Performance</h4><div class="mgrid">${mets.map(([l, k]) => `<div><b>${num(p.metrics[k])}</b><span>${l}</span></div>`).join('')}</div>${spark(hist)}` : ''}
    <h4>Local files</h4>${p.media.flatMap((x) => x.files).map((f) => `<div class="filebox">${esc(f.path)}<br><span style="color:var(--muted)">${bytes(f.size)}</span></div>`).join('') ||
      '<div class="warnbox">No local file matched this upload. Add the folder it came from to <code>LOCAL_MEDIA_DIRS</code>, or the file was changed after uploading.</div>'}
    ${p.dupPosts.length ? `<div class="warnbox">This exact video is live or scheduled ${p.dupPosts.length + 1}× on this account.</div>` : ''}
    ${list('Same video, same account', p.dupPosts)}${list('Same video, other accounts', p.crossPosts)}${list('Same caption, different video', p.sameCaptionPosts)}
    <h4>Caption</h4><pre>${esc(p.content)}</pre>
    ${p.comments.length ? `<h4>Follow-up comments</h4>${p.comments.map((c) => `<pre style="margin-bottom:6px">${esc(c.content)}<br><small style="color:var(--muted)">+${c.delay} min</small></pre>`).join('')}` : ''}`;
  $('#drawer .x').addEventListener('click', closeDrawer);
}

function spark(rows) {
  if (rows.length < 2) return '';
  const max = Math.max(...rows.map((r) => r.value)), min = Math.min(...rows.map((r) => r.value));
  const pts = rows.map((r, n) => `${(n / (rows.length - 1)) * 460},${58 - ((r.value - min) / (max - min || 1)) * 50}`).join(' ');
  return `<svg viewBox="0 0 460 64" style="width:100%;margin-top:10px"><polyline points="${pts}" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div style="color:var(--muted);font-size:12px">Views over ${rows.length} snapshots</div>`;
}

function closeDrawer() { drawerId = null; $('#drawer').hidden = true; $('#drawer').innerHTML = ''; }

/* ---------- boot ---------- */
async function render() {
  const r = route();
  renderShell(r);
  await ({ overview, posts, files }[r.page] ?? overview)(r);
}

async function poll() {
  app = { ...app, ...(await api('/api/state')) };
  renderShell(route());
  if (app.sync?.running) setTimeout(poll, 3000); else render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-post]');
  if (el) { e.preventDefault(); openDrawer(el.dataset.post); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
let timer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const { page, q } = route();
    const params = Object.fromEntries(q);
    params.q = e.target.value;
    location.hash = link(page, params);
  }, 250);
});
window.addEventListener('hashchange', () => { closeDrawer(); render(); });

app = { ...app, ...(await api('/api/state')) };
if (app.sync?.running) poll();
render();
setInterval(async () => { if (!app.sync?.running) { app = { ...app, ...(await api('/api/state')) }; renderShell(route()); } }, 60000);
