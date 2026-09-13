import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => console.error(e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.error(m.text());
});
await page.goto("http://localhost:5188", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.screenshot({ path: "docs/screenshots/v2-overview-review.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
await page.screenshot({ path: "docs/screenshots/v2-mobile-review.png" });
await browser.close();
