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
  smoothingMs: 55,
  cursorStillMs: 120,
  cursorMovingMs: 30,
  cursorDeadzone: 0.0025,
  cursorCatchupDistance: 0.06,
  poseHoldMs: 200,
  pointHoldMs: 120,
  pointGraceMs: 120,
  centerHoldMs: 320,
  centerStillRadius: 0.018,
  joystickDeadzone: 0.025,
  joystickRange: 0.15,
  dwellMs: 700,
  dwellRadius: 0.03,
  rotationMaxSpeed: 3.2,
  rotationResponseMs: 80,
  rotationTimeoutMs: 240,
  lossGraceMs: 230,
  lossCancelMs: 550,
};
