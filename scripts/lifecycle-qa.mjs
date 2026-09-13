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
const state = async () =>
  JSON.parse(await page.locator(".debug-panel pre").innerText());
const pull = async () => {
  const b = await page.locator(".scene").boundingBox();
  const p = await state();
  await page.mouse.click(
    b.x + (b.width * (p.firstPhotoScreenX + 1)) / 2,
    b.y + (b.height * (1 - p.firstPhotoScreenY)) / 2,
  );
};
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "切换调试面板" }).click();
  await expect
    .poll(async () => (await state()).loaded)
    .toBeGreaterThanOrEqual(5);
  await pull();
  await page.waitForTimeout(140);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  if ((await state()).state !== "PULLING")
    throw new Error("Visibility resume skipped the remaining transition");
  await expect.poll(async () => (await state()).state).toBe("FOCUSED");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state()).state).toBe("OVERVIEW");
  checks.push(
    "A simulated 1.5-second hidden interval preserves the remaining pull animation",
  );
  await pull();
  await page.waitForTimeout(140);
  const supported = await page.locator(".scene canvas").evaluate((c) => {
    const extension = c.getContext("webgl2").getExtension("WEBGL_lose_context");
    if (!extension) return false;
    window.__qaRestoreContext = () => extension.restoreContext();
    extension.loseContext();
    return true;
  });
  if (!supported) throw new Error("WEBGL_lose_context unavailable");
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__qaRestoreContext());
  await page.waitForTimeout(130);
  if ((await state()).state !== "PULLING")
    throw new Error("Context restore skipped remaining animation");
  await expect
    .poll(async () => (await state()).state, { timeout: 10000 })
    .toBe("FOCUSED");
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state()).state).toBe("OVERVIEW");
  if ((await state()).homeError > 1e-6)
    throw new Error("Restoration changed the home transform");
  checks.push(
    "Actual WebGL context loss/restoration resumes animation and returns to exact home",
  );
  const collection = await context.newPage();
  const samples = await (
    await context.request.get(base + "/samples/manifest.json")
  ).json();
  const photos = Array.from({ length: 120 }, (_, i) => ({
    ...samples[i % 10],
    id: "large-" + i,
    name: "第" + (i + 1) + "帧",
    source: "oss",
    expiresAt: Date.now() + 900000,
  }));
  await collection.route("**/api/config", (r) =>
    r.fulfill({
      json: {
        mode: "oss",
        maxBytes: 20971520,
        maxPhotos: 120,
        registration: "closed",
        user: { id: "fixture-large", username: "fixture" },
      },
    }),
  );
  await collection.route("**/api/photos", (r) =>
    r.fulfill({ json: { photos } }),
  );
  await collection.goto(base, { waitUntil: "networkidle" });
  await expect(
    collection.getByRole("button", { name: "120 帧记忆" }),
  ).toBeVisible();
  await collection.getByRole("button", { name: "120 帧记忆" }).click();
  await collection
    .getByRole("button", { name: "第120帧", exact: true })
    .click();
  await expect(
    collection.getByRole("button", { name: "分解为粒子" }),
  ).toBeEnabled();
  await expect(collection.locator(".focus-meta")).toContainText("第120帧");
  await collection.getByRole("button", { name: "返回总览" }).click();
  await expect(
    collection.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  await collection.getByRole("button", { name: "切换调试面板" }).click();
  const large = JSON.parse(
    await collection.locator(".debug-panel pre").innerText(),
  );
  if (large.homeError > 1e-6)
    throw new Error("Large collection return mismatch");
  checks.push(
    "120-photo metadata fixture: the last tier photo can be selected, loaded and returned",
  );
  const report = {
    date: new Date().toISOString(),
    checks,
    largeCollection: {
      count: 120,
      loaded: large.loaded,
      textures: large.textures,
      geometries: large.geometries,
      homeError: large.homeError,
    },
    scope:
      "Synthetic visibility event; real WebGL extension; mocked 120-photo metadata with bundled real images. Not a long-running device benchmark.",
  };
  await writeFile("docs/lifecycle-qa.json", JSON.stringify(report, null, 2));
  console.log(report);
} catch (e) {
  console.error(e);
  await page.screenshot({ path: "docs/screenshots/lifecycle-failure.png" });
  process.exitCode = 1;
} finally {
  await browser.close();
}
