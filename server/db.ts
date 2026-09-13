import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
 PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, expires INTEGER NOT NULL, photo_id TEXT);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, object_key TEXT NOT NULL, display_key TEXT NOT NULL, thumb_key TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS photos_owner ON photos(user_id,created_at);
 CREATE INDEX IF NOT EXISTS uploads_owner ON uploads(user_id,expires);
 `);
  return db;
}
export interface PhotoRow {
  id: string;
  user_id: string;
  name: string;
  object_key: string;
  display_key: string;
  thumb_key: string;
  width: number;
  height: number;
  size: number;
  created_at: string;
}
export interface UploadRow {
  id: string;
  user_id: string;
  object_key: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  expires: number;
  photo_id: string | null;
}
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}
