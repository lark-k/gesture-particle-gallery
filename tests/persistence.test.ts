import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../server/db";
test("SQLite retains owner, object keys and dimensions after close and reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stillspace-db-"));
  const path = join(dir, "gallery.sqlite");
  try {
    const db = openDatabase(path);
    db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
      "user-a",
      "owner",
      "hash",
      1,
    );
    db.prepare("INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      "photo-a",
      "user-a",
      "sample",
      "photos/user-a/original",
      "photos/user-a/view",
      "photos/user-a/thumb",
      1200,
      800,
      500,
      "2026-09-12",
    );
    db.close();
    const reopened = openDatabase(path);
    const row = reopened
      .prepare("SELECT user_id,width,height,thumb_key FROM photos WHERE id=?")
      .get("photo-a");
    assert.equal(row?.user_id, "user-a");
    assert.equal(row?.width, 1200);
    assert.equal(row?.height, 800);
    assert.equal(row?.thumb_key, "photos/user-a/thumb");
    reopened.close();
  } finally {
    for (const suffix of ["", "-shm", "-wal"])
      await unlink(path + suffix).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    await rmdir(dir);
  }
});
