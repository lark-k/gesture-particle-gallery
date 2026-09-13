import * as THREE from "three";
// A fixed UV cell belongs to either the plane or the point cloud. Complementary
// stochastic handoff avoids additive brightness or a second complete image.
const cellHash = `float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`;
const uniforms = (texture: THREE.Texture, cols: number, rows: number) => ({
  uMap: { value: texture },
  uMix: { value: 0 },
  uGrid: { value: new THREE.Vector2(cols, rows) },
  uDim: { value: 1 },
});
export function photoPlane(texture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: uniforms(texture, 1, 1),
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uMap; uniform float uMix; uniform float uDim; uniform vec2 uGrid; ${cellHash}
  void main(){ float handoff=smoothstep(0.,.20,uMix); if(handoff > hash(floor(vUv*uGrid))) discard; vec4 c=texture2D(uMap,vUv); gl_FragColor=vec4(c.rgb*uDim,c.a);
  #include <colorspace_fragment>
  }`,
    toneMapped: false,
  });
}
export function createParticles(
  width: number,
  height: number,
  texture: THREE.Texture,
  count: number,
  seed: number,
  reduced: boolean,
) {
  const cols = Math.max(12, Math.round(Math.sqrt((count * width) / height))),
    rows = Math.max(12, Math.round(count / cols));
  const positions = new Float32Array(cols * rows * 3),
    uv = new Float32Array(cols * rows * 2),
    scatter = new Float32Array(cols * rows * 3),
    seeds = new Float32Array(cols * rows);
  let state = seed | 0;
  const rand = () => {
    state = (Math.imul(1664525, state) + 1013904223) | 0;
    return (state >>> 0) / 4294967296;
  };
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x,
        u = (x + 0.5) / cols,
        v = (y + 0.5) / rows;
      positions.set([(u - 0.5) * width, (v - 0.5) * height, 0.012], i * 3);
      uv.set([u, v], i * 2);
      const angle = rand() * Math.PI * 2,
        r = 0.4 + rand() * 1.4,
        strength = reduced ? 0.22 : 0.65;
      scatter.set(
        [
          Math.cos(angle) * r * strength + (u - 0.5) * 1.2 * strength,
          Math.sin(angle) * r * 0.7 * strength,
          (rand() - 0.4) * 2.6 * strength,
        ],
        i * 3,
      );
      seeds[i] = rand();
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("aScatter", new THREE.BufferAttribute(scatter, 3));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(),
    Math.max(width, height) + 4,
  );
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms(texture, cols, rows),
      uPixelScale: { value: 500 },
      uCellSize: { value: width / cols },
    },
    transparent: false,
    depthWrite: true,
    toneMapped: false,
    vertexShader: `uniform float uMix; uniform float uPixelScale; uniform float uCellSize; attribute vec3 aScatter; attribute float aSeed; varying vec2 vUv; varying float vScatter;
 void main(){ vUv=uv; float d=smoothstep(.18,1.,uMix);vScatter=d; vec3 p=position+aScatter*d;float swirl=sin(d*3.14159)*.32; p.xy+=vec2(-aScatter.y,aScatter.x)*swirl; vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=clamp(uCellSize*uPixelScale/max(1.,-mv.z)*mix(1.20,.48,d)*(1.-.15*aSeed*d),1.,40.); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uMix; uniform float uDim; uniform vec2 uGrid;varying vec2 vUv;varying float vScatter;${cellHash}
 void main(){float handoff=smoothstep(0.,.20,uMix);if(handoff<=hash(floor(vUv*uGrid)))discard;vec2 q=gl_PointCoord-.5;float edge=length(q);float roundness=smoothstep(0.,.4,vScatter);if(edge>mix(.71,.48,roundness))discard;vec4 c=texture2D(uMap,vUv); float soft=1.-smoothstep(.25,.50,edge)*roundness*.38;gl_FragColor=vec4(c.rgb*uDim*soft,1.);
 #include <colorspace_fragment>
 }`,
  });
  return { points: new THREE.Points(geometry, material), cols, rows };
}
