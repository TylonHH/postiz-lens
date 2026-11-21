# Postiz Lens

A local, read-only dashboard add-on for [Postiz](https://postiz.com). It answers the questions the calendar can't:

- **How is each video performing?** Views, reach, likes, comments, shares and saves, tracked as regular snapshots in a local SQLite database.
- **Which local file was used for which post?** Uploads are matched to the files on your disk by content hash, not by file name.
- **Did I post something twice? Did I forget something?** Duplicates, reused captions, cross-posts, failed posts and local files that were never posted are flagged.
- **Per account.** Switch between all your connected channels from the sidebar.

No build step, no npm dependencies. One Node.js process, one SQLite file.

```bash
git clone https://github.com/<you>/postiz-lens && cd postiz-lens
npm run demo      # explore with synthetic data, no Postiz needed
```

## Setup

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`).

```bash
cp .env.example .env     # then fill in POSTIZ_API_URL and POSTIZ_API_KEY
npm start                # http://127.0.0.1:4747
```

| Variable | Meaning |
| --- | --- |
| `POSTIZ_API_URL` | `https://api.postiz.com` for Postiz Cloud, `https://your-domain/api` when self-hosted |
| `POSTIZ_API_KEY` | Postiz → Settings → Developers |
| `LOCAL_MEDIA_DIRS` | Folders with your source videos/images, separated by `;` (Windows) or `:` (macOS/Linux) |
| `SYNC_INTERVAL_MIN` | Refresh interval, default 60 |

Values are read from the environment first and from `.env` second. On Windows, user-level environment variables are used as a fallback.

`npm run sync` runs one sync from the command line. `npm test` runs the unit tests.

## How it works

1. **Sync** pulls channels and posts through the Postiz public API (`/integrations`, `/posts`), then fetches each post's media and follow-up comments.
2. **Stats** are requested from `/analytics/post/{id}` for published posts. The values are cumulative, so Lens stores a snapshot per run and builds the history itself. Fresh posts are re-measured every 6 hours, posts under 30 days old daily, older ones weekly.
3. **Local files** under `LOCAL_MEDIA_DIRS` are indexed. A local file is SHA-256 hashed only when a Postiz upload has exactly the same byte size, and an upload is downloaded and hashed only when its size collides with another upload or a local file. That keeps large libraries cheap, and progress is saved, so an interrupted first sync resumes where it stopped.
4. **Analysis** runs on every request over the local database:
   - *Duplicate*: the same file is live or scheduled more than once on the same account. Failed posts and drafts do not count.
   - *Cross-post*: the same file on different accounts. Informational.
   - *Same caption*: identical text (hashtags ignored) with a different video.
   - *Never posted*: a local file with no matching post. This respects the account filter, so you can see what you haven't posted on one specific channel.

Posts that disappear from Postiz are hidden from the dashboard on the next sync.

### Limits

- Metrics depend on the platform; Lens shows whatever Postiz returns and `–` otherwise.
- A re-encoded or edited file has a different hash and will not match its original. Matching is exact on purpose.
- The post detail call (`/public/posts/{id}`) is not in the published OpenAPI spec but is what the Postiz app uses to expose media and comments. If it ever changes, Lens still lists posts, but without media matching.
- Postiz rate limits are respected: `429` responses are retried after `Retry-After`, and analytics calls per sync are capped (`MAX_STATS_PER_SYNC`).

## Privacy and security

- Read-only. Lens never creates, edits or deletes anything in Postiz.
- Your API key stays on your machine, in `.env` or the environment, and is only sent to your Postiz instance.
- The server binds to `127.0.0.1` by default. It has **no authentication**, so do not expose it publicly. Local files are only served if they were indexed from `LOCAL_MEDIA_DIRS`.
- The database lives in `./data/` and is git-ignored.

## Project layout

```
src/postiz.mjs    Postiz API client
src/sync.mjs      sync pipeline (channels, posts, details, files, stats)
src/files.mjs     local scan and hashing
src/analyze.mjs   matching, duplicates, metrics (pure functions, tested)
src/server.mjs    HTTP API and static files
public/           the dashboard (vanilla JS, no build)
```

## License

MIT
