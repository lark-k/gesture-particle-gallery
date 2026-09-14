/** Damped local flow with a permanent rest position for every sampled memory point. */
export function stepMemorySpring(
  coordinates: Float32Array, origins: Float32Array, velocity: Float32Array,
  seconds: number, pointer: { x: number; y: number; radius: number } | null, reduced: boolean,
): number {
  const dt = Math.min(.035, Math.max(0, seconds));
  const drag = Math.exp(-7.8 * dt);
  let displacement = 0;
  for (let i=0; i<coordinates.length; i+=3) {
    if (reduced) {
      coordinates[i]=origins[i]; coordinates[i+1]=origins[i+1];
      velocity[i]=velocity[i+1]=0; continue;
    }
    velocity[i]+=(origins[i]-coordinates[i])*32*dt;
    velocity[i+1]+=(origins[i+1]-coordinates[i+1])*32*dt;
    if (pointer) {
      const x=coordinates[i]-pointer.x, y=coordinates[i+1]-pointer.y;
      const distance=Math.abs(x)<pointer.radius && Math.abs(y)<pointer.radius ? Math.sqrt(x*x+y*y) : pointer.radius;
      if(distance<pointer.radius) {
        const force=(1-distance/pointer.radius)**2*2300*dt/Math.max(4,distance);
        velocity[i]+=(x-y*.33)*force; velocity[i+1]+=(y+x*.33)*force;
      }
    }
    velocity[i]*=drag; velocity[i+1]*=drag;
    coordinates[i]+=velocity[i]*dt; coordinates[i+1]+=velocity[i+1]*dt;
    displacement=Math.max(displacement,Math.abs(coordinates[i]-origins[i]),Math.abs(coordinates[i+1]-origins[i+1]));
  }
  return displacement;
}
