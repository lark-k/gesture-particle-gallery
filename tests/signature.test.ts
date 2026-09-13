import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { OSSStorage } from "../server/storage";
import { getConfig } from "../server/config";
test("actual OSS SDK emits V4 POST HMAC and V4 private image read URL offline", async () => {
  const secret = "test-only-secret-not-a-real-key";
  const storage = new OSSStorage({
    ...getConfig(),
    region: "oss-cn-hangzhou",
    bucket: "test-only-bucket",
    accessKeyId: "test-only-access-id",
    accessKeySecret: secret,
    stsToken: "",
  });
  const grant = storage.grant("staging/user-a/fixed-id", "image/jpeg", 512);
  const f = grant.fields;
  assert.equal(f["x-oss-signature-version"], "OSS4-HMAC-SHA256");
  assert.equal("Signature" in f, false);
  const policy = JSON.parse(Buffer.from(f.policy, "base64").toString());
  assert.ok(
    policy.conditions.some(
      (v: unknown) =>
        JSON.stringify(v) ===
        JSON.stringify(["eq", "$key", "staging/user-a/fixed-id"]),
    ),
  );
  const hmac = (key: string | Buffer, value: string) =>
    createHmac("sha256", key).update(value).digest();
  const date = f["x-oss-date"].slice(0, 8);
  const key = hmac(
    hmac(hmac(hmac("aliyun_v4" + secret, date), "cn-hangzhou"), "oss"),
    "aliyun_v4_request",
  );
  assert.equal(
    createHmac("sha256", key).update(f.policy).digest("hex"),
    f["x-oss-signature"],
  );
  const url = new URL(await storage.read("photos/user-a/photo/view.jpg", 1600));
  assert.equal(
    url.searchParams.get("x-oss-signature-version"),
    "OSS4-HMAC-SHA256",
  );
  assert.equal(url.searchParams.get("x-oss-expires"), "900");
  assert.equal(
    url.searchParams.get("x-oss-process"),
    "image/resize,m_lfit,w_1600,h_1600/auto-orient,1",
  );
  assert.ok(!url.href.includes(secret));
});
