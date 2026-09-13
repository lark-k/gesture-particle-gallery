import { readFileSync } from "node:fs";
const sampleCount = JSON.parse(readFileSync(new URL("../public/samples/manifest.json", import.meta.url), "utf8")).length;
import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const base = process.env.TEST_URL || "http://localhost:5188",
  a = await context.newPage(),
  b = await context.newPage(),
  stamp = Date.now(),
  nameA = "qa_a_" + stamp,
  nameB = "qa_b_" + stamp;
const register = async (page, name) => {
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "还没有账户？创建账户" }).click();
  await page.getByLabel("用户名", { exact: true }).fill(name);
  await page.getByLabel("密码", { exact: true }).fill("Local-QA-session-123!");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
};
try {
  await a.goto(base, { waitUntil: "networkidle" });
  await register(a, nameA);
  await expect(a.getByRole("button", { name: "00 帧记忆" })).toBeVisible();
  const { mode } = await (await context.request.get(base + "/api/config")).json();
  await a.getByRole("button", { name: "添加照片" }).click();
  await a.getByLabel("选择照片").setInputFiles("public/samples/1.jpg");
  await expect(a.getByText(mode === "oss" ? "已保存至私有 OSS" : "已加入本次会话 · 未上传云端")).toBeVisible({ timeout: 60000 });
  await a.getByRole("button", { name: "返回影像空间" }).click();
  await expect(a.getByRole("button", { name: "01 帧记忆" })).toBeVisible();
  await b.goto(base, { waitUntil: "networkidle" });
  await expect(b.getByRole("button", { name: nameA })).toBeVisible();
  await b.getByRole("button", { name: nameA }).click();
  await expect(
    a.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await expect(a.getByRole("button", { name: `${sampleCount} 帧记忆` })).toBeVisible();
  await register(b, nameB);
  await expect(a.getByRole("button", { name: nameB })).toBeVisible();
  await expect(a.getByRole("button", { name: "00 帧记忆" })).toBeVisible();
  await a.getByRole("button", { name: nameB }).click();
  await expect(
    b.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  const report = {
    date: new Date().toISOString(),
    checks: [
      "Two real browser tabs share a logged-in session",
      "Logout in tab B clears tab A account and local photo resources",
      "Login as B updates tab A without reload; no samples or A photos carry over",
      "Logout propagates in the opposite direction",
    ],
    scope:
      `Actual local API accounts, cookies, BroadcastChannel/storage events; storage mode: ${mode}`,
  };
  await writeFile("docs/session-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  await a.screenshot({ path: "docs/screenshots/session-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
