import { GESTURE as G } from "../config";
import type { SceneState } from "../../shared/types";
import { CursorFilter, LandmarkFilter } from "./filter";
import { handGeometry } from "./geometry";

export interface Landmark { x: number; y: number; z: number }
export interface HandFrame {
  landmarks: Landmark[];
  worldLandmarks?: Landmark[];
  time: number;
  aspect: number;
}
type Point = { x: number; y: number };
type Pose = "open" | "point" | "unknown";
export interface GestureDebug {
  status: string;
  gesture: string;
  mode: "waiting" | "switching" | "calibrating" | "rotate" | "point" | "select" | "return" | "paused";
  pose: Pose;
  scale: number;
  progress: number;
  cursor: Point | null;
  target: string | null;
  rotationSpeed: number;
  neutral: Point | null;
  deflection: number;
}
export interface GestureContext {
  state: SceneState;
  candidate: string | null;
  hit: (x: number, y: number) => string | null;
  returnHit: (x: number, y: number) => boolean;
  target: (id: string | null) => void;
  pull: (id: string) => boolean | void;
  push: () => boolean | void;
  rotate: (v: number) => void;
}
const initialDebug = (): GestureDebug => ({
  status: "等待手部", gesture: "张掌浏览 · 单食指选片", mode: "waiting", pose: "unknown",
  scale: 0, progress: 0, cursor: null, target: null, rotationSpeed: 0, neutral: null, deflection: 0,
});

export class GestureRecognizer {
  debug = initialDebug();
  private landmarks = new LandmarkFilter();
  private cursor = new CursorFilter();
  private points: Landmark[] | null = null;
  private lastTime = -Infinity;
  private lastSeen = -Infinity;
  private phase: "browse" | "focus" | "busy" | null = null;
  private pose: Pose = "unknown";
  private pendingPose: Pose = "unknown";
  private poseAt = 0;
  private neutral: Point | null = null;
  private center: { point: Point; time: number } | null = null;
  private dwell: { id: string; anchor: Point; elapsed: number; time: number } | null = null;
  private actionLatched = false;
  private returnArmed = false;
  private uncertainAt: number | null = null;

  reset(_time?: number) {
    this.clearControls();
    this.landmarks.reset();
    this.cursor.reset();
    this.points = null;
    this.lastTime = this.lastSeen = -Infinity;
    this.phase = null;
    this.debug = initialDebug();
  }
  private clearControls() {
    this.pose = this.pendingPose = "unknown";
    this.neutral = null;
    this.center = null;
    this.dwell = null;
    this.returnArmed = false;
    this.actionLatched = false;
    this.uncertainAt = null;
  }
  lost(time: number, ctx: GestureContext) {
    if (!Number.isFinite(time) || time < this.lastTime) return;
    this.lastTime = time;
    ctx.rotate(0);
    ctx.target(null);
    this.clearControls();
    this.landmarks.reset();
    this.points = null;
    this.debug = { ...initialDebug(), status: "未检测到手 · 已停止", gesture: "重新张掌停稳，或伸食指选片",
      cursor: time - this.lastSeen <= G.lossCancelMs ? this.debug.cursor : null };
    if (!this.debug.cursor) this.cursor.reset();
  }
  private hold(id: string, point: Point, time: number) {
    if (!this.dwell || this.dwell.id !== id) {
      this.dwell = { id, anchor: point, elapsed: 0, time };
    } else {
      if (Math.hypot(point.x - this.dwell.anchor.x, point.y - this.dwell.anchor.y) > G.dwellRadius) {
        this.dwell.anchor = point;
        this.dwell.elapsed = 0;
      } else this.dwell.elapsed += Math.min(G.lossGraceMs, time - this.dwell.time);
      this.dwell.time = time;
    }
    this.debug.target = id;
    this.debug.progress = Math.min(1, this.dwell.elapsed / G.dwellMs);
    return this.debug.progress === 1;
  }
  process(frame: HandFrame, ctx: GestureContext) {
    const { time, aspect } = frame;
    if (!Number.isFinite(time) || time <= this.lastTime) return;
    const dt = Math.max(1, Math.min(100, time - this.lastTime));
    this.lastTime = time;
    if (frame.landmarks.length !== 21 || !Number.isFinite(aspect) || aspect <= 0 ||
        frame.landmarks.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) {
      this.lost(time, ctx);
      return;
    }
    const distance = (points: Landmark[], a: number, b: number) =>
      Math.hypot((points[a].x - points[b].x) * aspect, points[a].y - points[b].y);
    const scale = (distance(frame.landmarks, 0, 9) + distance(frame.landmarks, 5, 17)) / 2;
    if (scale < 0.035) {
      this.lost(time, ctx);
      return;
    }
    const phase = ctx.state === "FOCUSED" ? "focus" :
      ctx.state === "PULLING" || ctx.state === "PUSHING" ? "busy" : "browse";
    if (phase !== this.phase || time - this.lastSeen > G.lossGraceMs) {
      this.clearControls();
      this.landmarks.reset();
      this.points = null;
      this.cursor.reset();
      ctx.rotate(0);
      ctx.target(null);
      this.phase = phase;
    }
    this.lastSeen = time;
    const rawPose = handGeometry(frame.landmarks, aspect, frame.worldLandmarks, this.pose).pose;
    // Ambiguous poses must not pollute the pointer's median history.
    const stable = rawPose === "unknown" && this.pose === "point" && this.points
      ? this.points : this.landmarks.process(frame.landmarks);
    const alpha = 1 - Math.exp(-dt / G.smoothingMs);
    this.points = stable.map((p, i) => {
      const old = this.points?.[i];
      return old ? { x: old.x + (p.x - old.x) * alpha, y: old.y + (p.y - old.y) * alpha,
        z: old.z + (p.z - old.z) * alpha } : p;
    });
    // Use current geometry for the stop gate; filtered motion must never keep
    // rotating while the user is changing to a pointing pose.
    const previousCursor = this.debug.cursor;
    this.debug = { ...initialDebug(), status: "本地识别 · 单手", scale, pose: rawPose, neutral: this.neutral };
    if (phase === "busy" || this.actionLatched) {
      ctx.rotate(0);
      this.debug.mode = "paused";
      this.debug.gesture = "正在切换照片";
      return;
    }
    // A briefly ambiguous finger pose pauses dwell rather than erasing it.
    // No action may finish during ambiguity, and missing hands still reset fully.
    if (rawPose === "unknown" && this.pose === "point") {
      this.uncertainAt ??= time;
      ctx.rotate(0);
      if (time - this.uncertainAt > G.pointGraceMs) {
        this.dwell = null;
        ctx.target(null);
      }
      this.debug.cursor = previousCursor;
      this.debug.target = this.dwell?.id ?? null;
      this.debug.progress = this.dwell ? this.dwell.elapsed / G.dwellMs : 0;
      this.debug.mode = "switching";
      this.debug.gesture = "食指识别暂不稳定 · 自然伸直即可";
      return;
    }
    if (this.uncertainAt !== null) {
      if (this.dwell) this.dwell.time = time;
      this.uncertainAt = null;
    }
    if (rawPose !== this.pose || rawPose === "unknown") {
      ctx.rotate(0);
      ctx.target(null);
      this.dwell = null;
      this.center = null;
      if (rawPose !== this.pendingPose) {
        this.pendingPose = rawPose;
        this.poseAt = time;
      }
      if (rawPose === "unknown" || time - this.poseAt < (rawPose === "point" ? G.pointHoldMs : G.poseHoldMs)) {
        this.debug.mode = "switching";
        this.debug.gesture = rawPose === "unknown" ? "请张开手掌，或只伸出食指" : "保持手型片刻";
        return;
      }
      this.pose = rawPose;
      this.neutral = null;
      this.cursor.reset();
    }
    this.pendingPose = rawPose;
    this.poseAt = time;
    if (this.pose === "open") {
      this.dwell = null;
      ctx.target(null);
      if (phase === "focus") {
        ctx.rotate(0);
        this.debug.mode = "point";
        this.debug.gesture = "伸出食指，停留在返回按钮上";
        return;
      }
      const p = this.points;
      const palm = {
        x: 1 - (p[0].x + p[5].x + p[9].x + p[17].x) / 4,
        y: (p[0].y + p[5].y + p[9].y + p[17].y) / 4,
      };
      if (!this.neutral) {
        ctx.rotate(0);
        if (!this.center || Math.hypot(palm.x - this.center.point.x, palm.y - this.center.point.y) > G.centerStillRadius)
          this.center = { point: palm, time };
        this.debug.mode = "calibrating";
        this.debug.gesture = "张掌停稳 · 正在建立中立点";
        this.debug.progress = Math.min(1, (time - this.center.time) / G.centerHoldMs);
        if (this.debug.progress < 1) return;
        this.neutral = { ...palm };
      }
      const dx = palm.x - this.neutral.x;
      const range = Math.max(0.06, Math.min(G.joystickRange, this.neutral.x - 0.02, 0.98 - this.neutral.x));
      const strength = Math.min(1, Math.max(0, (Math.abs(dx) - G.joystickDeadzone) / (range - G.joystickDeadzone)));
      const speed = Math.sign(dx) * G.rotationMaxSpeed * Math.pow(strength, 1.3);
      ctx.rotate(speed);
      this.debug.mode = "rotate";
      this.debug.neutral = this.neutral;
      this.debug.deflection = Math.max(-1, Math.min(1, dx / range));
      this.debug.rotationSpeed = speed;
      this.debug.progress = 0;
      this.debug.gesture = !speed ? "中立点 · 已停转" : speed > 0 ? "向右旋转 · 保持位置即可" : "向左旋转 · 保持位置即可";
      return;
    }

    ctx.rotate(0);
    this.neutral = null;
    const point = this.cursor.process({
      x: Math.min(0.98, Math.max(0.02, (1 - stable[8].x - 0.12) / 0.76)),
      y: Math.min(0.98, Math.max(0.02, (stable[8].y - 0.1) / 0.8)),
    }, dt, false);
    this.debug.cursor = point;
    this.debug.mode = "point";
    if (phase === "focus") {
      const inside = ctx.returnHit(point.x, point.y);
      if (!inside) this.returnArmed = true;
      if (!inside || !this.returnArmed) {
        this.dwell = null;
        this.debug.gesture = this.returnArmed ? "食指移到返回按钮，停留确认" : "先移开光标，再指向返回按钮";
        return;
      }
      this.debug.mode = "return";
      this.debug.gesture = "保持停留 · 即将返回";
      if (this.hold("return", point, time)) {
        this.actionLatched = ctx.push() !== false;
        this.dwell = null;
      }
      return;
    }
    const hit = ctx.hit(point.x, point.y);
    ctx.target(hit);
    if (!hit) {
      this.dwell = null;
      this.debug.gesture = "食指指向任意照片 · 停留 0.7 秒打开";
      return;
    }
    this.debug.mode = "select";
    this.debug.gesture = "保持停留 · 即将打开照片";
    if (this.hold(hit, point, time)) {
      this.actionLatched = ctx.pull(hit) !== false;
      this.dwell = null;
    }
  }
}
