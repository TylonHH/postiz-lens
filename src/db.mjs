import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY, name TEXT, profile TEXT, provider TEXT, picture TEXT, disabled INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY, group_id TEXT, integration_id TEXT, state TEXT, publish_date TEXT,
  content TEXT, release_id TEXT, release_url TEXT, error TEXT, settings TEXT,
  media TEXT, comments TEXT, detail_at TEXT, deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS posts_integration ON posts(integration_id, publish_date);
CREATE TABLE IF NOT EXISTS stats (
  post_id TEXT NOT NULL, taken_at TEXT NOT NULL, label TEXT NOT NULL, value REAL,
  PRIMARY KEY (post_id, taken_at, label)
);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, root TEXT, kind TEXT, size INTEGER, mtime INTEGER, sha256 TEXT, seen_at TEXT
);
CREATE INDEX IF NOT EXISTS files_size ON files(size);
CREATE TABLE IF NOT EXISTS file_scopes (
  path TEXT NOT NULL, account TEXT NOT NULL, PRIMARY KEY (path, account)
);
CREATE TABLE IF NOT EXISTS remote_media (
  url TEXT PRIMARY KEY, size INTEGER, sha256 TEXT
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, ok INTEGER, summary TEXT
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export const all = (db, sql, ...params) => db.prepare(sql).all(...params);
export const one = (db, sql, ...params) => db.prepare(sql).get(...params);
export const run = (db, sql, ...params) => db.prepare(sql).run(...params);
