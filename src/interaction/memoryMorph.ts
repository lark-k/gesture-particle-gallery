/** A hover reversal retraces the same timeline rather than restarting the picture. */
export function advanceMemoryMorph(progress: number, active: boolean, seconds: number, reduced: boolean): number {
  if (reduced) return 0;
  const step = Math.min(.035, Math.max(0, seconds)) / 1.45;
  return Math.max(0, Math.min(1, progress + (active ? step : -step)));
}

export function memoryMorphEnvelope(progress: number): { morph: number; bridge: number } {
  const t = Math.max(0, Math.min(1, progress));
  return { morph: t * t * (3 - 2 * t), bridge: Math.sin(Math.PI * t) ** 2 };
}
