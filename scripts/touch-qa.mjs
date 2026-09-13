import { readFileSync } from "node:fs";
const sampleCount = JSON.parse(readFileSync(new URL("../public/samples/manifest.json", import.meta.url), "utf8")).length;
import { chromium, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
try {
  await page.goto(process.env.TEST_URL || "http://localhost:5188", {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(1000);
  const box = await page.locator(".scene").boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height * 0.3;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 12; i++) {
    await page.waitForTimeout(20);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + i * 3, y }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.getByRole("button", { name: "切换调试面板" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await page.locator(".debug-panel pre").innerText())
          .wallAngle,
    )
    .toBeLessThan(-0.02);
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.getByRole("button", { name: `${sampleCount} 帧记忆` }).click();
  await page.getByRole("button", { name: "雪山来信", exact: true }).click();
  await expect(page.getByRole("button", { name: "分解为粒子" })).toBeEnabled();
  const button = await page
    .getByRole("button", { name: "分解为粒子" })
    .boundingBox();
  await page.touchscreen.tap(
    button.x + button.width / 2,
    button.y + button.height / 2,
  );
  await expect(page.getByRole("button", { name: "聚合照片" })).toBeEnabled();
  await page.getByRole("button", { name: "返回总览" }).click();
  await expect(
    page.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  const report = {
    date: new Date().toISOString(),
    checks: [
      "Emulated touch drag rotates the real Three.js cylinder",
      "Collection directory opens photo on mobile",
      "Touchscreen tap dissolves photo; return remains available",
    ],
    scope: "390 × 844 touch emulation, not a physical mobile device",
  };
  await writeFile("docs/touch-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "docs/screenshots/touch-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
