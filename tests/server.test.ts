import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createApp } from "../server/app";
import { getConfig } from "../server/config";
import { uploadPolicy, type Storage } from "../server/storage";
import { passwordHash, verifyPassword } from "../server/auth";
class MemoryOSS implements Storage {
  objects = new Map<string, { data: Buffer; mime: string }>();
  grant(key: string, mime: string, size: number) {
    return {
      host: "https://test.invalid",
      fields: {
        key,
        "Content-Type": mime,
        policy: JSON.stringify(
          uploadPolicy(key, mime, size, "test", Date.now() + 120000),
        ),
      },
      expiresAt: Date.now() + 120000,
    };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    if (!o) throw new Error("not uploaded");
    return { size: o.data.length, mime: o.mime };
  }
  async get(key: string) {
    return this.objects.get(key)!.data;
  }
  async put(key: string, data: Buffer, mime: string) {
    this.objects.set(key, { data, mime });
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  read(key: string) {
    return `https://test.invalid/${key}?signature=mock`;
  }
}
test("password hashing is salted and rejects wrong passwords", async () => {
  const a = await passwordHash("correct password"),
    b = await passwordHash("correct password");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("correct password", a), true);
  assert.equal(await verifyPassword("bad password", a), false);
});
test("multi-user isolation, restricted grants, verified completion, idempotency and failure recovery", async () => {
  const storage = new MemoryOSS();
  const config = {
    ...getConfig(),
    database: ":memory:",
    production: false,
    registrationOpen: true,
    origin: "http://localhost:5173",
    adminPasswordHash: "",
    bucket: "",
  };
  const { app, db } = createApp(config, storage);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address() as { port: number },
    base = `http://127.0.0.1:${addr.port}`;
  const request = async (
    path: string,
    body?: unknown,
    cookie = "",
    origin = config.origin,
    accountId = "",
  ) => {
    const res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        Cookie: cookie,
        ...(accountId ? { "X-Account-ID": accountId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get("set-cookie")?.split(";")[0] || "",
    };
  };
  try {
    assert.equal((await request("/api/uploads/authorize", {})).status, 401);
    assert.equal(
      (
        await request(
          "/api/auth/register",
          { username: "alice", password: "long-password-123" },
          "",
          "https://evil.invalid",
        )
      ).status,
      403,
    );
    const alice = await request("/api/auth/register", {
        username: "alice",
        password: "long-password-123",
      }),
      bob = await request("/api/auth/register", {
        username: "bob",
        password: "another-password-456",
      });
    assert.equal(alice.status, 201);
    assert.equal(bob.status, 201);
    assert.ok(alice.cookie);
    assert.notEqual(alice.data.user.id, bob.data.user.id);
    const album = await request("/api/albums", { name: "Alice memories" }, alice.cookie);
    assert.equal(album.status, 201);
    const staleAccount = await request(
      "/api/uploads/authorize",
      {},
      bob.cookie,
      config.origin,
      alice.data.user.id,
    );
    assert.equal(staleAccount.status, 409);
    assert.equal(staleAccount.data.code, "ACCOUNT_CHANGED");
    assert.equal(
      (
        await request("/api/auth/login", {
          username: "alice",
          password: "wrong",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/uploads/authorize",
          {
            name: "huge",
            mime: "image/jpeg",
            size: 999999999,
            sha256: "0".repeat(64),
          },
          alice.cookie,
        )
      ).status,
      400,
    );
    const image = await sharp({
      create: {
        width: 100,
        height: 70,
        channels: 3,
        background: { r: 80, g: 130, b: 170 },
      },
    })
      .jpeg()
      .toBuffer();
    const body = {
      albumId: album.data.id,
      name: "我的照片",
      mime: "image/jpeg",
      size: image.length,
      sha256: createHash("sha256").update(image).digest("hex"),
    };
    const grant = await request("/api/uploads/authorize", body, alice.cookie);
    assert.equal(grant.status, 200);
    const { fields, uploadId } = grant.data;
    assert.ok(fields.key.startsWith(`staging/${alice.data.user.id}/`));
    const policy = JSON.parse(fields.policy);
    assert.ok(
      policy.conditions.some(
        (x: unknown) =>
          JSON.stringify(x) ===
          JSON.stringify(["content-length-range", image.length, image.length]),
      ),
    );
    assert.ok(
      policy.conditions.some(
        (x: unknown) =>
          JSON.stringify(x) === JSON.stringify(["eq", "$key", fields.key]),
      ),
    );
    assert.equal(
      (await request(`/api/uploads/${uploadId}/complete`, {}, bob.cookie))
        .status,
      404,
    );
    const missing = await request(
      `/api/uploads/${uploadId}/complete`,
      {},
      alice.cookie,
    );
    assert.equal(missing.status, 500);
    assert.equal(
      (await request("/api/photos", undefined, alice.cookie)).data.photos
        .length,
      0,
    );
    await storage.put(fields.key, image, "image/jpeg");
    const completed = await request(
      `/api/uploads/${uploadId}/complete`,
      {},
      alice.cookie,
    );
    assert.equal(completed.status, 201);
    assert.equal(completed.data.width, 100);
    assert.equal(completed.data.height, 70);
    assert.ok(
      completed.data.objectKey.startsWith(`photos/${alice.data.user.id}/`),
    );
    assert.equal(storage.objects.size, 3);
    const prefix = `photos/${alice.data.user.id}/${completed.data.id}`;
    assert.deepEqual([...storage.objects.keys()].sort(), [
      `${prefix}/original`, `${prefix}/thumb.jpg`, `${prefix}/view.jpg`,
    ]);
    const again = await request(
      `/api/uploads/${uploadId}/complete`,
      {},
      alice.cookie,
    );
    assert.equal(again.status, 200);
    assert.equal(again.data.id, completed.data.id);
    assert.equal(
      (await request("/api/photos", undefined, bob.cookie)).data.photos.length,
      0,
    );
    assert.equal(
      (
        await request(
          `/api/photos/${completed.data.id}/read`,
          undefined,
          bob.cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/api/photos/${completed.data.id}/read?size=500000`,
          undefined,
          alice.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request("/api/photos", undefined, alice.cookie)).data.photos
        .length,
      1,
    );
    const bad = await request(
      "/api/uploads/authorize",
      { ...body, sha256: "f".repeat(64) },
      alice.cookie,
    );
    await storage.put(bad.data.fields.key, image, "image/jpeg");
    assert.equal(
      (
        await request(
          `/api/uploads/${bad.data.uploadId}/complete`,
          {},
          alice.cookie,
        )
      ).status,
      422,
    );
    assert.equal(
      (await request("/api/photos", undefined, alice.cookie)).data.photos
        .length,
      1,
    );
    const expired = await request("/api/uploads/authorize", body, alice.cookie);
    db.prepare("UPDATE uploads SET expires=0 WHERE id=?").run(
      expired.data.uploadId,
    );
    assert.equal(
      (
        await request(
          `/api/uploads/${expired.data.uploadId}/complete`,
          {},
          alice.cookie,
        )
      ).status,
      410,
    );
    await request("/api/auth/logout", {}, alice.cookie);
    assert.equal(
      (await request("/api/photos", undefined, alice.cookie)).status,
      401,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
test("private registration requires configured invitation", async () => {
  const { app, db } = createApp({
    ...getConfig(),
    database: ":memory:",
    bucket: "",
    adminPasswordHash: "",
    registrationOpen: false,
    inviteCode: "test-invite",
    origin: "http://localhost:5173",
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  const { port } = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({
        username: "newuser",
        password: "long-password-123",
        inviteCode: "wrong",
      }),
    });
    assert.equal(res.status, 403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  }
});
