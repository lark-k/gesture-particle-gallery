import { GESTURE as G } from "../config";
import type { SceneState } from "../../shared/types";
export interface Landmark {
  x: number;
  y: number;
  z: number;
}
export interface HandFrame {
  landmarks: Landmark[];
  confidence: number;
  time: number;
  aspect: number;
}
export interface GestureDebug {
  status: string;
  gesture: string;
  scale: number;
  progress: number;
  pinch: number;
  cursor: { x: number; y: number } | null;
  locked: string | null;
}
export interface GestureContext {
  state: SceneState;
  candidate: string | null;
  hit: (x: number, y: number) => string | null;
  target: (id: string | null) => void;
  pull: (id: string) => void;
  push: () => void;
  rotate: (v: number) => void;
}
interface Sample {
  t: number;
  x: number;
  y: number;
  scale: number;
  tilt: number;
}
export class GestureRecognizer {
  debug: GestureDebug = {
    status: "等待手部",
    gesture: "无",
    scale: 0,
    progress: 0,
    pinch: 1,
    cursor: null,
    locked: null,
  };
  private points: Landmark[] | null = null;
  private lastTime = 0;
  private lastSeen = 0;
  private history: Sample[] = [];
  private pinched = false;
  private grab: { id: string; base: Sample; thresholdAt: number } | null = null;
  private pushBase: Sample | null = null;
  private pushAt = 0;
  private candidate: string | null = null;
  private dwellAt = 0;
  private cooldownUntil = 0;
  private rearmAt = 0;
  private armed = true;
  private previousState: SceneState = "OVERVIEW";
  private openAt = 0;
  reset(time = performance.now()) {
    this.points = null;
    this.history = [];
    this.pinched = false;
    this.grab = null;
    this.pushBase = null;
    this.candidate = null;
    this.pushAt = 0;
    this.dwellAt = 0;
    this.openAt = 0;
    this.cooldownUntil = time + G.cooldownMs;
    this.armed = false;
    this.rearmAt = 0;
    this.debug.locked = null;
    this.debug.progress = 0;
  }
  lost(time: number, ctx: GestureContext) {
    this.debug.status = "未检测到手";
    this.debug.gesture = "无";
    this.debug.progress = 0;
    if (time - this.lastSeen > G.lossGraceMs) {
      this.history = [];
      this.pushBase = null;
      this.grab = null;
      this.debug.locked = null;
    }
    if (time - this.lastSeen > G.lossCancelMs) {
      this.reset(time);
      this.debug.cursor = null;
      ctx.target(null);
    }
  }
  process(frame: HandFrame, ctx: GestureContext) {
    const { time, aspect } = frame;
    if (frame.landmarks.length !== 21 || frame.confidence < G.confidence) {
      this.lost(time, ctx);
      return;
    }
    if (ctx.state !== this.previousState) {
      if (ctx.state === "OVERVIEW" || ctx.state === "FOCUSED") this.reset(time);
      this.previousState = ctx.state;
    }
    if (time - this.lastSeen > G.lossGraceMs) {
      this.points = null;
      this.history = [];
      this.grab = null;
      this.pushBase = null;
    }
    const dt = Math.max(1, time - this.lastTime),
      alpha = 1 - Math.exp(-dt / G.smoothingMs);
    this.lastTime = time;
    this.lastSeen = time;
    this.points = frame.landmarks.map((p, i) => {
      const old = this.points?.[i];
      return old
        ? {
            x: old.x + (p.x - old.x) * alpha,
            y: old.y + (p.y - old.y) * alpha,
            z: old.z + (p.z - old.z) * alpha,
          }
        : p;
    });
    const p = this.points;
    const dist = (a: number, b: number) =>
      Math.hypot((p[a].x - p[b].x) * aspect, p[a].y - p[b].y);
    // Only 2D palm measurements; wrist-relative z is never a distance cue.
    const scale = (dist(0, 9) + dist(5, 17)) / 2;
    if (scale < 0.035) {
      this.lost(time, ctx);
      return;
    }
    const x = 1 - (p[0].x + p[5].x + p[9].x + p[17].x) / 4,
      y = (p[0].y + p[5].y + p[9].y + p[17].y) / 4;
    const tilt = dist(5, 17) / Math.max(0.001, dist(0, 9));
    const pinch = dist(4, 8) / scale;
    const wasPinched = this.pinched;
    this.pinched = pinch < (wasPinched ? G.pinchExit : G.pinchEnter);
    const open =
      [8, 12, 16, 20].every((tip) => dist(tip, 0) > dist(tip - 2, 0) * 1.16) &&
      !this.pinched;
    const cursor = {
      x: Math.min(0.98, Math.max(0.02, (1 - p[8].x - 0.12) / 0.76)),
      y: Math.min(0.98, Math.max(0.02, (p[8].y - 0.1) / 0.8)),
    };
    const sample = { t: time, x, y, scale, tilt };
    this.history.push(sample);
    this.history = this.history.filter((s) => time - s.t <= G.swipeWindowMs);
    this.debug = {
      status: "正在识别 · 单手",
      gesture: this.pinched ? "捏合锁定" : open ? "张开手掌" : "指向",
      scale,
      progress: 0,
      pinch,
      cursor,
      locked: this.grab?.id || null,
    };
    if (ctx.state === "PULLING" || ctx.state === "PUSHING") return;
    const old = this.history[0];
    const speed =
      (Math.abs(x - old.x) * aspect) /
      scale /
      Math.max(0.06, (time - old.t) / 1000);
    if (!this.armed) {
      if (speed < 0.45 && !this.pinched) {
        if (!this.rearmAt) this.rearmAt = time;
        if (time - this.rearmAt > G.rearmStillMs) this.armed = true;
      } else this.rearmAt = 0;
    }
    if (time < this.cooldownUntil) return;
    if (ctx.state === "FOCUSED") {
      if (!open) {
        this.pushBase = null;
        this.openAt = 0;
        this.pushAt = 0;
        return;
      }
      if (!this.openAt) this.openAt = time;
      if (time - this.openAt < 180) return;
      if (!this.pushBase) this.pushBase = sample;
      const b = this.pushBase;
      if (
        time - b.t > G.maxDepthMs ||
        Math.abs(tilt - b.tilt) > G.maxTiltChange ||
        Math.hypot((x - b.x) * aspect, y - b.y) > b.scale * 0.75
      ) {
        this.pushBase = sample;
        this.pushAt = 0;
        return;
      }
      const ratio = scale / b.scale;
      this.debug.progress = Math.max(
        0,
        Math.min(1, (ratio - 1) / (G.pushRatio - 1)),
      );
      this.debug.gesture = "张掌前推";
      if (ratio >= G.pushRatio && time - b.t >= G.minDepthMs) {
        if (!this.pushAt) this.pushAt = time;
        if (time - this.pushAt >= G.depthHoldMs) {
          ctx.push();
          this.reset(time);
        }
      } else if (ratio < G.pushRatio - 0.06) this.pushAt = 0;
      return;
    }
    if (this.pinched) {
      if (!wasPinched && ctx.candidate)
        this.grab = { id: ctx.candidate, base: sample, thresholdAt: 0 };
      if (!this.grab) return;
      const b = this.grab.base;
      this.debug.locked = this.grab.id;
      if (
        time - b.t > G.maxDepthMs ||
        Math.abs(tilt - b.tilt) > G.maxTiltChange ||
        Math.hypot((x - b.x) * aspect, y - b.y) > b.scale * 1.1
      ) {
        this.grab = null;
        return;
      }
      const ratio = scale / b.scale;
      this.debug.progress = Math.max(
        0,
        Math.min(1, (1 - ratio) / (1 - G.pullRatio)),
      );
      this.debug.gesture = "抓取后拉";
      if (ratio <= G.pullRatio && time - b.t >= G.minDepthMs) {
        if (!this.grab.thresholdAt) this.grab.thresholdAt = time;
        if (time - this.grab.thresholdAt >= G.depthHoldMs) {
          const id = this.grab.id;
          ctx.pull(id);
          this.reset(time);
        }
      } else if (ratio > G.pullRatio + 0.05) this.grab.thresholdAt = 0;
      return;
    }
    this.grab = null;
    const hit = ctx.hit(cursor.x, cursor.y);
    if (hit !== this.candidate) {
      this.candidate = hit;
      this.dwellAt = time;
      ctx.target(null);
    }
    if (hit && time - this.dwellAt >= G.dwellMs) ctx.target(hit);
    if (!open || !this.armed) return;
    const dx = ((x - old.x) * aspect) / scale,
      dy = Math.abs(y - old.y) / scale;
    if (
      Math.abs(dx) >= G.swipeDistance &&
      speed >= G.swipeSpeed &&
      dy < 0.55 &&
      time - old.t >= 100
    ) {
      ctx.rotate(Math.sign(dx) * 0.7);
      this.debug.gesture = dx > 0 ? "向右扒拉" : "向左扒拉";
      this.cooldownUntil = time + G.cooldownMs;
      this.armed = false;
      this.rearmAt = 0;
      this.history = [];
      ctx.target(null);
    }
  }
}
