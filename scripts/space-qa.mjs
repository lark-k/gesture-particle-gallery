import { readFileSync } from "node:fs";
const sampleCount = JSON.parse(readFileSync(new URL("../public/samples/manifest.json", import.meta.url), "utf8")).length;
import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const snapshot = async () =>
  JSON.parse(await page.locator(".debug-panel pre").innerText());
try {
  await page.goto(process.env.TEST_URL || "http://localhost:5188", {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "暂停自动漫游" }).click();
  // Drag through a full revolution, using the same pointer path as a visitor.
  for (let turn = 0; turn < 10; turn++) {
    await page.mouse.move(580, 430);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(580 + i * 16, 430);
      await page.waitForTimeout(45);
    }
    await page.mouse.up();
    await page.waitForTimeout(550);
    if (turn === 1)
      await page.screenshot({ path: "docs/screenshots/07-inside-orbit.png" });
  }
  await page.getByRole("button", { name: "切换调试面板" }).click();
  const orbit = await snapshot();
  if (Math.abs(orbit.wallAngle) < Math.PI * 2)
    throw new Error("Pointer revolution did not complete");
  await expect.poll(async () => (await snapshot()).loaded).toBeGreaterThanOrEqual(Math.min(sampleCount, 24));
  if (orbit.homeError > 1e-6)
    throw new Error("Orbit changed local home transforms");
  checks.push(
    "A full pointer-driven revolution loads all photos in the first two inward-facing radial bands; homes remain exact",
  );
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: "docs/screenshots/08-tablet.png" });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(
    page.getByRole("button", { name: "开启自动漫游" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "开启自动漫游" }).click();
  await expect(
    page.getByRole("button", { name: "暂停自动漫游" }),
  ).toBeVisible();
  await page.getByRole("button", { name: `${sampleCount} 帧记忆` }).click();
  await page.getByRole("button", { name: "旷野之上", exact: true }).click();
  await expect(page.getByRole("button", { name: "分解为粒子" })).toBeEnabled();
  await page.screenshot({ path: "docs/screenshots/09-mobile-focused.png" });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("375px overflow");
  const meta = await page.locator(".focus-meta").boundingBox();
  const toolbar = await page.locator(".focus-toolbar").boundingBox();
  if (meta.y + meta.height > toolbar.y)
    throw new Error("Photo metadata overlaps the action dock");
  await page.getByRole("button", { name: "返回总览" }).click();
  await expect(
    page.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  checks.push(
    "375px and 768px layouts render; mobile orbit control works; a tall photo opens and returns with separate metadata/actions",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  const report = {
    date: new Date().toISOString(),
    checks,
    completeOrbitRadians: Math.abs(orbit.wallAngle),
    errors,
    scope:
      "Actual Edge WebGL rendering and pointer input, emulated viewport sizes. Not physical mobile hardware.",
  };
  await writeFile("docs/space-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "docs/screenshots/space-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
