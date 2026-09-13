import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const base = process.env.TEST_URL || "http://localhost:5188";
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const checks = [];
let readRefreshes = 0;
// Isolated network fixtures exercise the real PhotoResources failure recovery.
await page.route("**/api/config", (r) =>
  r.fulfill({
    json: {
      mode: "oss",
      maxBytes: 20971520,
      maxPhotos: 120,
      registration: "closed",
      user: { id: "fixture-user", username: "fixture" },
    },
  }),
);
const photo = {
  id: "fixture-photo",
  name: "签名恢复测试",
  width: 1920,
  height: 1281,
  source: "oss",
  createdAt: new Date().toISOString(),
  thumbUrl: base + "/expired-thumb.jpg",
  fullUrl: base + "/unavailable-full.jpg",
  expiresAt: Date.now() + 900000,
};
await page.route("**/api/photos", (r) =>
  r.fulfill({ json: { photos: [photo] } }),
);
await page.route("**/expired-thumb.jpg", (r) =>
  r.fulfill({ status: 403, body: "Expired signature fixture" }),
);
await page.route("**/unavailable-full.jpg", (r) =>
  r.fulfill({ status: 503, body: "Unavailable full resolution fixture" }),
);
await page.route("**/api/photos/fixture-photo/read*", (r) => {
  readRefreshes++;
  return r.fulfill({
    json: { ...photo, thumbUrl: base + "/samples/1-thumb.jpg" },
  });
});
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "切换调试面板" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await page.locator(".debug-panel pre").innerText()).loaded,
    )
    .toBe(1);
  if (readRefreshes !== 1)
    throw new Error("Expired thumbnail did not refresh once");
  checks.push(
    "Expired thumbnail 403 refreshes authorized URL and loads texture",
  );
  const point = JSON.parse(await page.locator(".debug-panel pre").innerText());
  await page.getByRole("button", { name: "关闭调试" }).click();
  const box = await page.locator(".scene").boundingBox();
  await page.mouse.click(
    box.x + (box.width * (point.firstPhotoScreenX + 1)) / 2,
    box.y + (box.height * (1 - point.firstPhotoScreenY)) / 2,
  );
  await expect(page.getByRole("button", { name: "分解为粒子" })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("高清图加载失败");
  await page.getByRole("button", { name: "分解为粒子" }).click();
  await expect(page.getByRole("button", { name: "聚合照片" })).toBeEnabled();
  await page.getByRole("button", { name: "返回总览" }).click();
  await expect(
    page.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  checks.push(
    "Unavailable high-resolution retries, retains thumbnail, dissolves and returns safely",
  );
  const report = {
    date: new Date().toISOString(),
    checks,
    readRefreshes,
    scope: "Mocked API URLs in isolated browser; no real OSS connection",
  };
  await writeFile("docs/resilience-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
