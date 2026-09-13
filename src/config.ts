import type { Quality } from "../shared/types";
export const QUALITY: Record<
  Quality,
  { dpr: number; particles: number; stars: number }
> = {
  low: { dpr: 1, particles: 5500, stars: 160 },
  medium: { dpr: 1.5, particles: 14000, stars: 320 },
  high: { dpr: 2, particles: 28000, stars: 520 },
};
export const MOTION = {
  travelMs: 1200,
  dissolveMs: 850,
  entryMs: 1100,
  maxSpeed: 0.72,
  damping: 5.5,
  idleDelayMs: 1800,
  idleSpeed: 0.075,
};
export const SPACE = {
  innerRadius: 11.2,
  outerRadius: 18.2,
  cameraZ: 5.2,
  floorY: -6.6,
  desktopFov: 60,
  mobileFov: 76,
  parallax: 0.16,
};
export const GESTURE = {
  confidence: 0.7,
  smoothingMs: 85,
  dwellMs: 420,
  pinchEnter: 0.3,
  pinchExit: 0.46,
  pullRatio: 0.79,
  pushRatio: 1.27,
  depthHoldMs: 170,
  minDepthMs: 300,
  maxDepthMs: 2200,
  swipeDistance: 1.0,
  swipeSpeed: 1.7,
  swipeWindowMs: 400,
  cooldownMs: 1000,
  rearmStillMs: 420,
  lossGraceMs: 230,
  lossCancelMs: 550,
  maxTiltChange: 0.23,
};
