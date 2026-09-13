import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
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
  // Additive, transactional migration: original object keys and photo IDs are retained.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS albums(
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      cover_preset TEXT NOT NULL DEFAULT 'meadow', cover_photo_id TEXT,
      cover_x REAL NOT NULL DEFAULT 50, cover_y REAL NOT NULL DEFAULT 50,
      position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS albums_owner ON albums(user_id,position,created_at);
      CREATE TABLE IF NOT EXISTS storage_cleanup(object_key TEXT PRIMARY KEY);`);
    for (const table of ["photos", "uploads"]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some(c => c.name === "album_id"))
        db.exec(`ALTER TABLE ${table} ADD COLUMN album_id TEXT REFERENCES albums(id)`);
    }
    const owners = db.prepare(`SELECT user_id FROM photos WHERE album_id IS NULL
      UNION SELECT user_id FROM uploads WHERE album_id IS NULL`).all();
    for (const owner of owners) {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare("INSERT INTO albums(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(id, owner.user_id, "默认相册集", now, now);
      db.prepare("UPDATE photos SET album_id=? WHERE user_id=? AND album_id IS NULL").run(id, owner.user_id);
      db.prepare("UPDATE uploads SET album_id=? WHERE user_id=? AND album_id IS NULL").run(id, owner.user_id);
    }
    db.exec("CREATE INDEX IF NOT EXISTS photos_album ON photos(user_id,album_id,created_at)");
    for (const table of ["photos", "uploads"]) {
      for (const event of ["INSERT", "UPDATE OF album_id,user_id"]) {
        db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_album_${event.startsWith("INSERT") ? "insert" : "update"}
          BEFORE ${event} ON ${table} WHEN NEW.album_id IS NULL OR NOT EXISTS
          (SELECT 1 FROM albums WHERE id=NEW.album_id AND user_id=NEW.user_id)
          BEGIN SELECT RAISE(ABORT,'album ownership mismatch'); END;`);
      }
    }
    db.exec("PRAGMA user_version=1; COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  return db;
}
export interface AlbumRow {
  id: string; user_id: string; name: string; description: string;
  cover_preset: string; cover_photo_id: string | null; cover_x: number; cover_y: number;
  position: number; created_at: string; updated_at: string;
}
export interface PhotoRow {
  id: string;
  album_id: string;
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
  album_id: string;
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
