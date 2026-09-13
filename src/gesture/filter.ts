import { GESTURE as G } from "../config";
import type { Landmark } from "./recognizer";

// A three-frame median rejects isolated landmark spikes before they can affect
// pointing or palm position. It adds one camera frame of latency.
export class LandmarkFilter {
  private frames: Landmark[][] = [];

  reset() {
    this.frames = [];
  }

  process(points: Landmark[]) {
    this.frames.push(points);
    if (this.frames.length > 3) this.frames.shift();
    if (this.frames.length < 3) return this.frames[0];
    const median = (a: number, b: number, c: number) =>
      a + b + c - Math.min(a, b, c) - Math.max(a, b, c);
    return points.map((_, i) => {
      const [a, b, c] = this.frames.map((frame) => frame[i]);
      return {
        x: median(a.x, b.x, c.x),
        y: median(a.y, b.y, c.y),
        z: median(a.z, b.z, c.z),
      };
    });
  }
}

export class CursorFilter {
  private point: { x: number; y: number } | null = null;

  reset() {
    this.point = null;
  }

  process(next: { x: number; y: number }, dt: number, frozen: boolean) {
    if (!this.point) this.point = { ...next };
    if (frozen) return { ...this.point };
    const dx = next.x - this.point.x, dy = next.y - this.point.y;
    const distance = Math.hypot(dx, dy);
    if (distance > G.cursorDeadzone) {
      const motion = Math.min(1, distance / G.cursorCatchupDistance);
      const tau = G.cursorStillMs + (G.cursorMovingMs - G.cursorStillMs) * motion;
      const alpha = (1 - Math.exp(-dt / tau)) * (1 - G.cursorDeadzone / distance);
      this.point = { x: this.point.x + dx * alpha, y: this.point.y + dy * alpha };
    }
    return { ...this.point };
  }
}
