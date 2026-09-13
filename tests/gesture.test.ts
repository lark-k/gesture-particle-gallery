import test from "node:test";
import assert from "node:assert/strict";
import {
  GestureRecognizer,
  type GestureContext,
  type Landmark,
} from "../src/gesture/recognizer";
function hand(x = 0.5, s = 1, pinch = false): Landmark[] {
  const p = Array.from({ length: 21 }, () => ({ x, y: 0.65, z: 0 }));
  const base: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ] = [
    [0.44, 0.49],
    [0.49, 0.47],
    [0.54, 0.49],
    [0.59, 0.52],
  ];
  p[0] = { x, y: 0.72, z: 0 };
  for (let f = 0; f < 4; f++) {
    const [fx, fy] = base[f];
    for (let j = 0; j < 4; j++)
      p[5 + f * 4 + j] = { x: x + (fx - 0.5), y: fy - j * 0.075, z: 0 };
  }
  p[4] = { x: x - 0.15, y: 0.5, z: 0 };
  if (pinch) p[4] = { ...p[8], x: p[8].x + 0.015 };
  return p.map((v) => ({
    x: x + (v.x - x) * s,
    y: 0.6 + (v.y - 0.6) * s,
    z: 0,
  }));
}
function harness(state: GestureContext["state"] = "OVERVIEW") {
  const r = new GestureRecognizer(),
    events: string[] = [];
  const ctx: GestureContext = {
    state,
    candidate: null,
    hit: () => "photo-a",
    target: (id) => {
      ctx.candidate = id;
    },
    pull: (id) => events.push("pull:" + id),
    push: () => events.push("push"),
    rotate: (v) => events.push(v < 0 ? "left" : "right"),
  };
  return { r, events, ctx };
}
test("pinch alone does not pull; sustained shrinking palm after pinch pulls the locked target", () => {
  const { r, events, ctx } = harness();
  for (let t = 1000; t <= 2600; t += 50)
    r.process({ landmarks: hand(), confidence: 0.98, time: t, aspect: 1 }, ctx);
  assert.equal(ctx.candidate, "photo-a");
  for (let t = 2650; t <= 3200; t += 50)
    r.process(
      { landmarks: hand(0.5, 1, true), confidence: 0.98, time: t, aspect: 1 },
      ctx,
    );
  assert.equal(events.length, 0);
  ctx.candidate = "other";
  for (let t = 3250; t <= 3800; t += 50)
    r.process(
      {
        landmarks: hand(0.5, 0.64, true),
        confidence: 0.98,
        time: t,
        aspect: 1,
      },
      ctx,
    );
  assert.deepEqual(events, ["pull:photo-a"]);
});
test("open palm moving closer only returns in FOCUSED; hand loss never triggers depth actions", () => {
  const { r, events, ctx } = harness("FOCUSED");
  for (let t = 1000; t <= 3000; t += 50)
    r.process({ landmarks: hand(), confidence: 0.98, time: t, aspect: 1 }, ctx);
  for (let t = 3050; t <= 3650; t += 50)
    r.process(
      { landmarks: hand(0.5, 1.5), confidence: 0.98, time: t, aspect: 1 },
      ctx,
    );
  assert.deepEqual(events, ["push"]);
  const b = harness();
  for (let t = 1000; t < 2600; t += 50)
    b.r.process(
      { landmarks: hand(), confidence: 0.98, time: t, aspect: 1 },
      b.ctx,
    );
  b.r.process(
    { landmarks: hand(0.5, 1, true), confidence: 0.98, time: 2600, aspect: 1 },
    b.ctx,
  );
  for (let t = 2650; t < 4000; t += 50) b.r.lost(t, b.ctx);
  assert.deepEqual(b.events, []);
  assert.equal(b.ctx.candidate, null);
});
test("mirror mapping rotates visually right and rearm suppresses immediate return stroke", () => {
  const { r, events, ctx } = harness();
  for (let t = 1000; t <= 2400; t += 50)
    r.process(
      { landmarks: hand(0.7), confidence: 0.98, time: t, aspect: 1 },
      ctx,
    );
  for (let i = 1; i <= 7; i++)
    r.process(
      {
        landmarks: hand(0.7 - i * 0.065),
        confidence: 0.98,
        time: 2400 + i * 40,
        aspect: 1,
      },
      ctx,
    );
  for (let i = 1; i <= 7; i++)
    r.process(
      {
        landmarks: hand(0.245 + i * 0.065),
        confidence: 0.98,
        time: 2680 + i * 40,
        aspect: 1,
      },
      ctx,
    );
  assert.deepEqual(events, ["right"]);
});
