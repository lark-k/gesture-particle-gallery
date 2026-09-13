import { SPACE } from "../config";

// Deterministic, inward-facing annular slots. Radial and elevation offsets
// create parallax while appended uploads never move an existing home.
export function ringColumns(count: number) {
  return Math.max(5, Math.min(16, Math.ceil(count / 2)));
}
export function photoSlot(index: number, columns: number, aspect: number) {
  const column = Math.floor(index / 2) % columns;
  const signed =
    column === 0
      ? 0
      : column % 2
        ? -Math.ceil(column / 2)
        : Math.ceil(column / 2);
  const row = index % 2;
  const tier = Math.floor(index / (columns * 2));
  const tierY = tier ? Math.ceil(tier / 2) * 10.2 * (tier % 2 ? 1 : -1) : 0;
  const variation = Math.sin(column * 2.399 + row * 1.7);
  const radius = (row ? SPACE.outerRadius : SPACE.innerRadius) + variation * 1.35;
  const theta = ((signed + row * 0.5) * Math.PI * 2) / columns;
  const maxWidth = Math.min(
    row ? 7.0 : 7.6,
    2 * radius * Math.sin(Math.PI / columns) * 0.83,
  );
  const height = Math.min(row ? 2.25 : 4.8, maxWidth / aspect);
  return {
    x: Math.sin(theta) * radius,
    y: (row ? .35 + variation * 1.05 : .15 + variation * .55) + tierY,
    z: -Math.cos(theta) * radius,
    rotationY: -theta,
    width: height * aspect,
    height,
  };
}
