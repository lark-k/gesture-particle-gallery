import test from "node:test";
import assert from "node:assert/strict";
import { GestureRotation } from "../src/interaction/gestureRotation";

test("faster input rotates farther over the same time and is not capped at mouse speed", () => {
  const integrate = (input: number) => {
    const motion = new GestureRotation();
    let angle = 0, speed = 0;
    for (let time = 0; time < 1000; time += 10) {
      if (time % 50 === 0) motion.set(input, time);
      speed = motion.step(time, 0.01);
      angle += speed * 0.01;
    }
    return { angle, speed };
  };
  const slow = integrate(0.8), fast = integrate(2.4);
  assert.ok(fast.angle > slow.angle * 2.9);
  assert.ok(fast.speed > 2.3);
  assert.ok(integrate(-2.4).angle < -2);
});

test("rotation reverses smoothly and expires if camera frames stop arriving", () => {
  const motion = new GestureRotation();
  motion.set(2, 0);
  for (let t = 0; t <= 150; t += 10) motion.step(t, 0.01);
  motion.set(-2, 160);
  let speed = 0;
  for (let t = 160; t <= 350; t += 10) speed = motion.step(t, 0.01);
  assert.ok(speed < -1.5);
  for (let t = 360; t <= 1000; t += 10) speed = motion.step(t, 0.01);
  assert.ok(Math.abs(speed) < 0.01);
  motion.clear();
  assert.equal(motion.step(1010, 0.01), 0);
});
