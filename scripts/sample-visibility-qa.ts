import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { createApp } from "../server/app";
import { getConfig } from "../server/config";

// Run against the built UI with an isolated, disposable account database.
// Uses the configured storage adapter; never uploads files or touches user data.
const config = {
  ...getConfig(), database: ":memory:", production: false,
  registrationOpen: true, adminPasswordHash: "",
};
const { app, db } = createApp(config);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
config.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  let sampleRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/samples/")) sampleRequests++;
  });
  const sampleCount = JSON.parse(readFileSync("public/samples/manifest.json", "utf8")).length;
  const count = (n: number) => page.getByRole("button", { name: `${String(n).padStart(2, "0")} 帧记忆` });
  const register = async (username: string) => {
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("button", { name: "还没有账户？创建账户" }).click();
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill("Sample-visibility-QA-123!");
    await page.getByRole("button", { name: "创建账户", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(count(0)).toBeVisible();
  };
  await page.goto(config.origin, { waitUntil: "networkidle" });
  await expect(count(sampleCount)).toBeVisible();
  assert.ok(sampleRequests > 0, "Guests load actual samples");
  await register("sample_qa_a");
  sampleRequests = 0;
  await page.reload({ waitUntil: "networkidle" });
  await expect(count(0)).toBeVisible();
  assert.equal(sampleRequests, 0, "Signed-in empty accounts must not request any sample assets");
  await expect(page.getByText("添加第一张照片，开启你的影像空间")).toBeVisible();
  const second = await context.newPage();
  await second.goto(config.origin, { waitUntil: "networkidle" });
  await second.getByRole("button", { name: "sample_qa_a" }).click();
  await expect(count(sampleCount)).toBeVisible();
  await register("sample_qa_b");
  await expect(second.getByRole("button", { name: "sample_qa_b" })).toBeVisible();
  await expect(second.getByRole("button", { name: "00 帧记忆" })).toBeVisible();
  await page.getByRole("button", { name: "sample_qa_b" }).click();
  await expect(count(sampleCount)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(count(sampleCount)).toBeVisible();
  assert.equal(await page.locator(".mode-badge").count(), 0);
  console.log("PASS: guest samples, empty authenticated gallery, zero signed-in sample requests, reload, two-account isolation, cross-tab logout/login and mobile layout");
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
