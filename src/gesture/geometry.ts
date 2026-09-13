import type { Landmark } from "./recognizer";

export function handGeometry(points: Landmark[], aspect: number, world?: Landmark[], previousPose?: "open" | "point" | "unknown") {
  const hasWorld = world?.length === 21 && world.every(
    (p) => [p.x, p.y, p.z].every(Number.isFinite),
  );
  const p = hasWorld ? world! : points;
  // Normalized z uses the image-width scale, just like normalized x.
  const ax = hasWorld ? 1 : aspect;
  const distance = (a: number, b: number) => Math.hypot(
    (p[a].x - p[b].x) * ax, p[a].y - p[b].y, (p[a].z - p[b].z) * ax,
  );
  const scale = (distance(0, 9) + distance(5, 17)) / 2;
  const extension = [8, 12, 16, 20].map((tip) => {
    const length = distance(tip - 3, tip - 2) + distance(tip - 2, tip - 1) + distance(tip - 1, tip);
    // Joint-chain extension works when fingers point towards the lens too.
    return length > 0.0001 ? distance(tip - 3, tip) / length : 0;
  });
  // Natural pointing leaves the other fingers partly bent, not tightly curled.
  // Compare index extension with the other fingers; reject a straight middle
  // finger (a V sign). Separate entry/release thresholds prevent pose flicker.
  const keepingPoint = previousPose === "point";
  const others = extension.slice(1);
  const medianOther = [...others].sort((a,b) => a-b)[1];
  const pointing = extension[0] > (keepingPoint ? 0.68 : 0.78) &&
    extension[1] < (keepingPoint ? 0.94 : 0.90) &&
    others.filter(v => v < (keepingPoint ? 0.91 : 0.86)).length >= 2 &&
    extension[0] - medianOther > (keepingPoint ? 0.08 : 0.12);
  const pose: "open" | "point" | "unknown" = pointing ? "point" :
    extension.filter((v) => v > 0.86).length >= 3 ? "open" : "unknown";
  return { pose, extension, scale };
}
