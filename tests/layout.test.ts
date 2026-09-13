import { test } from "node:test";
import assert from "node:assert/strict";
import { photoSlot, ringColumns } from "../src/scene/layout";
import { SPACE } from "../src/config";

test("the viewer lies inside both complete photo rings and every face points inward", () => {
  const columns = ringColumns(20);
  assert.equal(columns, 10);
  assert.ok(
    SPACE.cameraZ < SPACE.innerRadius && SPACE.innerRadius < SPACE.outerRadius,
  );
  const angles = new Set<number>();
  for (let i = 0; i < 20; i++) {
    const s = photoSlot(i, columns, 1.5);
    const normal = { x: Math.sin(s.rotationY), z: Math.cos(s.rotationY) };
    assert.ok(normal.x * -s.x + normal.z * (SPACE.cameraZ - s.z) > 0);
    const base = i % 2 ? SPACE.outerRadius : SPACE.innerRadius;
    assert.ok(Math.abs(Math.hypot(s.x, s.z) - base) <= 1.35);
    if (i % 2 === 0)
      angles.add(
        Math.round(((s.rotationY + Math.PI * 2) % (Math.PI * 2)) * 1000),
      );
  }
  assert.equal(angles.size, columns);
});

test("120 photo slots preserve aspect ratio, separate radial bands and have stable homes", () => {
  const columns = ringColumns(120),
    homes = new Set<string>();
  for (let i = 0; i < 120; i++) {
    const aspect = [0.4, 1.5, 3.8][i % 3];
    const s = photoSlot(i, columns, aspect);
    assert.ok(Math.abs(s.width / s.height - aspect) < 1e-8);
    const key = [s.x, s.y, s.z].map((n) => n.toFixed(5)).join(",");
    assert.ok(!homes.has(key));
    homes.add(key);
    assert.deepEqual(photoSlot(i, columns, aspect), s);
  }
  const top = photoSlot(0, columns, 0.4),
    bottom = photoSlot(1, columns, 0.4);
  assert.ok(Math.hypot(bottom.x, bottom.z) - Math.hypot(top.x, top.z) > 3);
});
