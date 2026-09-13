import { GESTURE as G } from "../config";

export class GestureRotation {
  private target = 0;
  private speed = 0;
  private updatedAt = -Infinity;

  set(speed: number, time: number, reduced = false) {
    const limit = reduced ? 1.2 : G.rotationMaxSpeed;
    this.target = Number.isFinite(speed) ? Math.max(-limit, Math.min(limit, speed)) : 0;
    this.updatedAt = time;
  }

  clear() {
    this.target = this.speed = 0;
    this.updatedAt = -Infinity;
  }

  step(time: number, dt: number) {
    const target = time - this.updatedAt <= G.rotationTimeoutMs ? this.target : 0;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * 1000 / G.rotationResponseMs));
    if (Math.abs(this.speed) < 0.001) this.speed = 0;
    return this.speed;
  }
}
