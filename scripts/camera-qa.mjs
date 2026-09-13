import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const context = await browser.newContext({
  permissions: ["camera"],
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
await page.addInitScript(() => {
  const original = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  window.__qaCameraTracks = [];
  navigator.mediaDevices.getUserMedia = async (options) => {
    const stream = await original(options);
    window.__qaCameraTracks.push(...stream.getTracks());
    return stream;
  };
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.TEST_URL || "http://localhost:5188", {
    waitUntil: "networkidle",
  });
  for (const delay of [20, 60, 140]) {
    await page.getByRole("button", { name: "开启手势控制" }).click();
    await page.waitForTimeout(delay);
    await page.getByRole("button", { name: "关闭手势" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__qaCameraTracks.filter((t) => t.readyState === "live")
              .length,
        ),
      )
      .toBe(0);
  }
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole("button", { name: "开启手势控制" }).click();
  await expect(page.locator(".camera-preview")).toContainText(
    /本地识别|CPU 12 Hz/,
    { timeout: 40000 },
  );
  await page.waitForTimeout(2000);
  const status = await page.locator(".camera-preview").innerText();
  await page.getByRole("button", { name: "关闭手势" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__qaCameraTracks.filter((t) => t.readyState === "live").length,
      ),
    )
    .toBe(0);
  const released = await page
    .locator("video")
    .evaluate((v) => v.srcObject === null && v.paused);
  if (!released) throw new Error("Camera not released");
  await page.getByRole("button", { name: "开启手势控制" }).click();
  await expect(page.locator(".camera-preview")).toContainText(
    /本地识别|CPU 12 Hz/,
    { timeout: 40000 },
  );
  await page.getByRole("button", { name: "关闭手势" }).click();
  const report = {
    date: new Date().toISOString(),
    status,
    released,
    restartPassed: true,
    rapidCancelCycles: 3,
    errors,
    note: "Synthetic camera color bars only; no real hand-gesture validation.",
  };
  await writeFile("docs/camera-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "docs/screenshots/camera-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
