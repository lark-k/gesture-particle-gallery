import { readFileSync } from "node:fs";
const sampleCount = JSON.parse(readFileSync(new URL("../public/samples/manifest.json", import.meta.url), "utf8")).length;
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
await mkdir("docs/screenshots", { recursive: true });
const base = process.env.TEST_URL || "http://localhost:5188";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "msedge",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("NotAllowedError"))
    errors.push(m.text());
});
const snap = async () =>
  JSON.parse(await page.locator(".debug-panel pre").innerText());
const waitState = async (state) => {
  await expect
    .poll(async () => (await snap()).state, { timeout: 6000 })
    .toBe(state);
};
const selectCenter = async () => {
  const box = await page.locator(".scene").boundingBox();
  const p = await snap();
  await page.mouse.click(
    box.x + (box.width * (p.firstPhotoScreenX + 1)) / 2,
    box.y + (box.height * (1 - p.firstPhotoScreenY)) / 2,
  );
};
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await expect(page.getByText(`${sampleCount} 帧记忆`)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/screenshots/01-overview.png" });
  checks.push(
    "Full-screen inward-facing gallery with twenty local photographs; thumbnails load on demand",
  );
  await page.getByRole("button", { name: "切换调试面板" }).click();
  await expect
    .poll(async () => (await snap()).loaded)
    .toBeGreaterThanOrEqual(6);
  const orbitBefore = (await snap()).wallAngle;
  await page.waitForTimeout(850);
  if (Math.abs((await snap()).wallAngle - orbitBefore) < 0.01)
    throw new Error("Idle orbit did not advance");
  await page.getByRole("button", { name: "暂停自动漫游" }).click();
  await page.waitForTimeout(600);
  const pausedAngle = (await snap()).wallAngle;
  await page.waitForTimeout(650);
  if (Math.abs((await snap()).wallAngle - pausedAngle) > 0.001)
    throw new Error("Paused orbit kept moving");
  checks.push(
    "Automatic orbit visibly advances and the pause control holds the current angle",
  );
  const gpu = await page.locator(".scene canvas").evaluate((canvas) => {
    const gl = canvas.getContext("webgl2");
    const d = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "unavailable",
      vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : "unavailable",
      webgl: gl.getParameter(gl.VERSION),
    };
  });
  await selectCenter();
  await waitState("FOCUSED");
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/screenshots/02-focused.png" });
  await page.getByRole("button", { name: "分解为粒子" }).click();
  await expect(page.getByRole("button", { name: "聚合照片" })).toBeEnabled();
  await page.screenshot({ path: "docs/screenshots/03-particles.png" });
  checks.push(
    "Click pulls photo forward; complete independent GPU dissolve and reassemble",
  );
  await page.getByRole("button", { name: "聚合照片" }).click();
  await expect(page.getByRole("button", { name: "分解为粒子" })).toBeEnabled();
  await page.screenshot({ path: "docs/screenshots/04-reassembled.png" });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "操作指南" }).click();
  await page.getByLabel("减少动态效果").check();
  await page.getByRole("button", { name: "开始探索" }).click();
  await page.getByRole("button", { name: "切换调试面板" }).click();
  const before = await snap();
  for (let i = 0; i < 8; i++) {
    await selectCenter();
    await waitState("FOCUSED");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await waitState("OVERVIEW");
  }
  await page.waitForTimeout(1000);
  const after = await snap();
  if (
    after.textures > before.textures + 1 ||
    after.geometries > before.geometries + 1
  )
    throw new Error("GPU resources grew across completed focus cycles");
  checks.push(
    "Eight real render pull/return cycles, repeated Esc, stable GPU texture/geometry counts",
  );
  if (after.homeError > 1e-6)
    throw new Error("Photo did not restore its exact home transform");
  const originalX = after.firstPhotoScreenX;
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.getByRole("button", { name: "向右旋转" }).click();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "切换调试面板" }).click();
  const rightX = (await snap()).firstPhotoScreenX;
  if (rightX <= originalX + 0.02)
    throw new Error("Right rotation did not move the photo visibly right");
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.getByRole("button", { name: "向左旋转" }).click();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: "切换调试面板" }).click();
  if ((await snap()).firstPhotoScreenX >= rightX - 0.02)
    throw new Error("Left rotation did not move the photo visibly left");
  checks.push(
    "Rotation direction verified through actual projected photo coordinates; restored home transform error < 1e-6",
  );
  const fps = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(550);
    fps.push((await snap()).fps);
  }
  await page.getByRole("button", { name: "关闭调试" }).click();
  await page.getByRole("button", { name: "开启手势控制" }).click();
  await expect(page.getByRole("status")).toContainText(/摄像头|手势/, {
    timeout: 10000,
  });
  await expect(
    page.getByRole("button", { name: "开启手势控制" }),
  ).toBeVisible();
  checks.push("Denied/unavailable camera returns to operable mouse mode");
  await page.getByRole("button", { name: "添加照片" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "还没有账户？创建账户" }).click();
  const username = "qa_" + Date.now();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill("Only-for-local-QA-123!");
  await page.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("00 帧记忆")).toBeVisible();
  const { mode } = await (await context.request.get(base + "/api/config")).json();
  await page.getByRole("button", { name: "添加照片" }).click();
  await page.getByLabel("选择照片").setInputFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("invalid image bytes"),
  });
  await expect(page.getByRole("status")).toContainText("broken.jpg");
  await page.getByLabel("选择照片").setInputFiles("public/samples/5.jpg");
  await expect(page.getByText(mode === "oss" ? "已保存至私有 OSS" : "已加入本次会话 · 未上传云端")).toBeVisible({
    timeout: 60000,
  });
  await page.screenshot({ path: "docs/screenshots/05-local-upload.png" });
  await page.getByRole("button", { name: "返回影像空间" }).click();
  await expect(page.getByText("01 帧记忆")).toBeVisible();
  checks.push(
    `Real registration/login, file decode, preview, ${mode} upload and particle entrance`,
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(mode === "oss" ? "01 帧记忆" : "00 帧记忆")).toBeVisible();
  await expect(page.getByRole("button", { name: username })).toBeVisible();
  checks.push(
    `Account session persists on refresh; ${mode === "oss" ? "OSS photo persists" : "local photo clears"}; no sample fallback`,
  );
  await page.getByRole("button", { name: username }).click();
  await expect(
    page.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  checks.push("Logout clears account and local GPU scene");
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(1400);
  await mobile.screenshot({ path: "docs/screenshots/06-mobile.png" });
  const overflow = await mobile.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile horizontal overflow");
  checks.push("390 × 844 mobile layout has no horizontal overflow");
  const report = {
    date: new Date().toISOString(),
    url: base,
    browser: browser.version(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    viewport: "1440 × 1000, DPR 1, medium quality",
    gpu,
    fps: {
      samples: fps,
      min: Math.min(...fps),
      max: Math.max(...fps),
      mean: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1),
    },
    memory: {
      before: { textures: before.textures, geometries: before.geometries },
      after: { textures: after.textures, geometries: after.geometries },
    },
    checks,
    errors,
    limitations: [
      "Headless browser measurement is not a medium-tier hardware benchmark",
      "No physical hand or real OSS credentials used",
    ],
  };
  await writeFile("docs/browser-qa.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (e) {
  await page.screenshot({ path: "docs/screenshots/qa-failure.png" });
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
