import test from "node:test";
import assert from "node:assert/strict";
import { uploadPhoto, type PreparedPhoto } from "../src/upload/client";
const prepared = (): PreparedPhoto => ({
  albumId: "album-a",
  file: new File(["image bytes"], "photo.jpg", { type: "image/jpeg" }),
  preview: "blob:test",
  local: {
    id: "local",
    name: "photo",
    width: 10,
    height: 10,
    thumbUrl: "blob:test",
    source: "local",
    createdAt: "2026-09-12",
  },
  revoke: () => {},
});
test("manual retry reuses the completed upload ticket after all completion responses are lost", async () => {
  const previousFetch = globalThis.fetch,
    previousXHR = globalThis.XMLHttpRequest;
  let grants = 0,
    transfers = 0,
    completions = 0;
  class XHR {
    status = 200;
    timeout = 0;
    upload = { onprogress: null };
    onload: () => void = () => {};
    open() {}
    send() {
      transfers++;
      queueMicrotask(() => this.onload());
    }
    abort() {}
  }
  globalThis.XMLHttpRequest = XHR as unknown as typeof XMLHttpRequest;
  globalThis.fetch = (async (input) => {
    const path = String(input);
    if (path.endsWith("/authorize")) {
      grants++;
      return Response.json({
        uploadId: "same-ticket",
        host: "https://test.invalid",
        fields: {},
        expiresAt: Date.now() + 120000,
      });
    }
    if (path.endsWith("/complete")) {
      completions++;
      if (completions <= 3)
        throw new TypeError("Completion response lost after server commit");
      return Response.json({ id: "single-photo", source: "oss" });
    }
    throw new Error("Unexpected request " + path);
  }) as typeof fetch;
  try {
    const p = prepared(),
      signal = new AbortController().signal;
    await assert.rejects(
      uploadPhoto(p, () => {}, signal),
      /response lost/,
    );
    assert.equal(p.uploadedGrant?.uploadId, "same-ticket");
    const result = await uploadPhoto(p, () => {}, signal);
    assert.equal(result.id, "single-photo");
    assert.equal(grants, 1);
    assert.equal(transfers, 1);
    assert.equal(completions, 4);
    assert.equal(p.uploadedGrant, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.XMLHttpRequest = previousXHR;
  }
});
test("expired uncommitted ticket is discarded so retry can request a new authorization", async () => {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    requests.push(String(input));
    return String(input).endsWith("/complete")
      ? Response.json({ error: "expired" }, { status: 410 })
      : Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const p = prepared();
    p.uploadedGrant = {
      uploadId: "expired",
      host: "https://test.invalid",
      fields: {},
      expiresAt: 0,
    };
    await assert.rejects(
      uploadPhoto(p, () => {}, new AbortController().signal),
      /expired/,
    );
    assert.equal(p.uploadedGrant, undefined);
    assert.deepEqual(requests, [
      "/api/uploads/expired/complete",
      "/api/uploads/expired/cancel",
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
