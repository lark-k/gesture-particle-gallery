/** Start at the original pose; gently fold around the photographed diagonal spine. */
export function memoryBookBreath(seconds: number, morph: number, motion: boolean): number {
  if (!motion) return 0;
  const idle = 1 - Math.max(0, Math.min(1, morph));
  return Math.sin(seconds * Math.PI * 2 / 7.5) * idle * idle;
}

// Shared by the photo mesh and its particles so they stay attached during a transition.
export const memoryBookDeformation = `
  uniform float pageBreath;
  uniform vec2 pageSize;
  vec3 foldMemoryPage(vec3 p, vec2 uv) {
    float spine = .6935 - .132 * uv.y;
    float distanceFromSpine = uv.x - spine;
    float upperEdge = mix(.76, .89, smoothstep(.58, .9, uv.x));
    float book = smoothstep(.22, .34, uv.x) * (1. - smoothstep(.92, 1., uv.x))
      * smoothstep(.07, .17, uv.y) * (1. - smoothstep(upperEdge, upperEdge + .10, uv.y));
    float fold = pageBreath * book;
    // Outer edges lift and move towards the fixed spine as the pages gently close.
    p.x -= distanceFromSpine * pageSize.x * .032 * fold;
    p.y += abs(distanceFromSpine) * pageSize.y * .08 * fold;
    p.z += abs(distanceFromSpine) * pageSize.x * .045 * fold;
    return p;
  }
`;
