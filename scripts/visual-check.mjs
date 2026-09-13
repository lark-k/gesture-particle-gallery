import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://localhost:5188", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await page.screenshot({ path: "docs/screenshots/01-overview.png" });
console.log(await page.locator("body").innerText());
console.log("Errors:", errors);
await writeFile(
  "docs/screenshots/initial-check.json",
  JSON.stringify({ errors }, null, 2),
);
await browser.close();
