import * as THREE from "three";
import type {
  Photo,
  Quality,
  SceneState,
  ParticleState,
} from "../../shared/types";
import { InteractionMachine } from "../interaction/machine";
import { GestureRotation } from "../interaction/gestureRotation";
import { QUALITY, MOTION, SPACE } from "../config";
import { PhotoResources } from "../resources/photos";
import { photoPlane, createParticles } from "./particles";
import { photoSlot, ringColumns } from "./layout";
import { PhotoCaptions } from "./environment";
import { NaturalEnvironment } from "./naturalEnvironment";
import type { ThemeId } from "./themes";

interface Tile {
  photo: Photo;
  group: THREE.Group;
  plane: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  edge: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  caption: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  home: THREE.Vector3;
  rotation: THREE.Quaternion;
  width: number;
  height: number;
  particles?: ReturnType<typeof createParticles>;
  mix: number;
  loaded: boolean;
  failed: boolean;
}
export interface SceneSnapshot {
  environment: { theme: ThemeId | null; ready: boolean; hdrReady: boolean };
  state: SceneState;
  particles: ParticleState;
  selected: Photo | null;
  candidate: Photo | null;
  fps: number;
  count: number;
  loaded: number;
  quality: Quality;
  textures: number;
  geometries: number;
  drawCalls: number;
  wallAngle: number;
  firstPhotoScreenX: number;
  firstPhotoScreenY: number;
  orbiting: boolean;
  homeError: number;
}
interface Animation {
  start: number;
  duration: number;
  update: (t: number) => void;
  finish: () => void;
}
const ease = (t: number) => t * t * (3 - 2 * t);
export class GalleryScene {
  readonly machine = new InteractionMachine();
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private wall = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(SPACE.desktopFov, 1, 0.1, 130);
  private environment: NaturalEnvironment;
  private captions = new PhotoCaptions();
  private columns = 5;
  private autoOrbit = true;
  private gestureControl = false;
  private parallax = new THREE.Vector2();
  private resources: PhotoResources;
  private tiles: Tile[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private stars: THREE.Points;
  private observer: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private pausedAt: number | null = null;
  private contextUnavailable = false;
  private previous = 0;
  private lastReport = 0;
  private frames = 0;
  private elapsed = 0;
  private speed = 0;
  private gestureRotation = new GestureRotation();
  private lastInput = performance.now() - MOTION.idleDelayMs;
  private animation: Animation | null = null;
  private entries: Tile[] = [];
  private entry: Tile | null = null;
  private entryStart = 0;
  private drag: {
    x: number;
    y: number;
    lastX: number;
    lastTime: number;
    distance: number;
  } | null = null;
  private quality: Quality;
  private reduced: boolean;
  private dim = 1;
  private loadActive = 0;
  onChange: (s: SceneSnapshot) => void = () => {};
  onError: (message: string) => void = () => {};
  onReturn: () => void = () => {};
  constructor(
    private host: HTMLElement,
    quality: Quality,
    reduced: boolean,
  ) {
    this.quality = quality;
    this.reduced = reduced;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x0b1015, 0);
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, QUALITY[quality].dpr),
    );
    this.host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "可拖动旋转、点击查看的三维照片墙",
    );
    this.resources = new PhotoResources(
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.environment = new NaturalEnvironment(this.renderer, this.scene);
    this.scene.add(this.wall, this.environment.group);
    this.camera.position.set(0, 0, SPACE.cameraZ);
    this.camera.lookAt(0, 0, -10);
    const starGeo = new THREE.BufferGeometry(),
      pos = new Float32Array(QUALITY.high.stars * 3),
      colors = new Float32Array(QUALITY.high.stars * 3);
    let seed = 9876;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < QUALITY.high.stars; i++) {
      pos.set(
        [(rand() - 0.5) * 40, -5.5 + rand() * 13, (rand() - 0.5) * 42],
        i * 3,
      );
      const c = 0.07 + rand() ** 3 * 0.3;
      colors.set([c * 0.87, c * 0.94, c], i * 3);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    starGeo.setDrawRange(0, QUALITY[quality].stars);
    this.stars = new THREE.Points(
      starGeo,
      new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 600 }, uDim: { value: 1 } },
        vertexColors: true,
        vertexShader: `uniform float uScale; varying vec3 vColor; void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(uScale*.025/max(1.,-mv.z),.8,4.5);}`,
        fragmentShader: `varying vec3 vColor; uniform float uDim; void main(){float d=length(gl_PointCoord-.5);float a=(1.-smoothstep(.08,.5,d))*.65*uDim;gl_FragColor=vec4(vColor,a);
          #include <colorspace_fragment>
        }`,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.scene.add(this.stars);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    const c = this.renderer.domElement;
    c.addEventListener("pointerdown", this.down);
    c.addEventListener("pointermove", this.move);
    c.addEventListener("pointerup", this.up);
    c.addEventListener("pointercancel", this.cancel);
    c.addEventListener("pointerleave", this.leave);
    c.addEventListener("webglcontextlost", this.contextLost);
    c.addEventListener("webglcontextrestored", this.contextRestored);
    window.addEventListener("keydown", this.key);
    document.addEventListener("visibilitychange", this.visibility);
    this.frame = requestAnimationFrame(this.tick);
  }
  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[q].dpr));
    this.stars.geometry.setDrawRange(0, QUALITY[q].stars);
    this.resize();
    this.emit();
  }
  setReduced(v: boolean) {
    this.reduced = v;
  }
  setTheme(theme: ThemeId) {
    return this.environment.setTheme(theme);
  }
  setOrbiting(v: boolean) {
    this.autoOrbit = v;
    this.lastInput = performance.now() - MOTION.idleDelayMs;
    this.emit();
  }
  setGestureControl(active: boolean) {
    this.gestureControl = active;
    this.speed = 0;
    this.gestureRotation.clear();
    this.lastInput = performance.now();
    this.emit();
  }
  private resize() {
    const { width, height } = this.host.getBoundingClientRect();
    this.camera.aspect = width / Math.max(1, height);
    this.environment.resize(this.camera.aspect);
    this.camera.fov = width < 650 ? SPACE.mobileFov : SPACE.desktopFov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.machine.state === "FOCUSED") {
      const t = this.selected();
      if (t) this.focusTransform(t);
    }
  }
  private focusBounds() {
    const h = Math.max(1, this.host.clientHeight),
      mobile = this.host.clientWidth < 701;
    const top = mobile ? 108 : h <= 720 ? 90 : 110;
    const bottom = mobile ? 250 : h <= 720 ? 225 : 235;
    const safeHeight = Math.max(100, h - top - bottom);
    const worldHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 6;
    return {
      height: (worldHeight * safeHeight) / h,
      width: worldHeight * this.camera.aspect * 0.82,
      y: worldHeight * (0.5 - (top + safeHeight / 2) / h),
    };
  }
  private focusTransform(t: Tile) {
    const bounds = this.focusBounds();
    const scale = Math.min(bounds.height / t.height, bounds.width / t.width);
    t.group.position.set(
      this.camera.position.x,
      this.camera.position.y + bounds.y,
      this.camera.position.z - 6,
    );
    t.group.quaternion.identity();
    t.group.scale.setScalar(scale);
  }
  addPhotos(photos: Photo[], animate = false) {
    if (!this.tiles.length) this.columns = ringColumns(photos.length);
    for (const photo of photos) {
      if (this.tiles.some((t) => t.photo.id === photo.id)) continue;
      const i = this.tiles.length;
      const slot = photoSlot(i, this.columns, photo.width / photo.height);
      const { width, height } = slot;
      const group = new THREE.Group(),
        placeholder = new THREE.Texture();
      const material = photoPlane(placeholder);
      placeholder.dispose();
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        material,
      );
      plane.position.z = 0.024;
      plane.visible = false;
      plane.userData.id = photo.id;
      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.025, height + 0.025, 0.038),
        new THREE.MeshStandardMaterial({ color: 0x28302b, roughness: 0.72, metalness: 0.12 }),
      );
      edge.position.z = -0.004;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(width + 0.055, height + 0.055, 0.045),
        ),
        new THREE.LineBasicMaterial({
          color: 0xc9b38f,
          transparent: true,
          opacity: 0,
        }),
      );
      const caption = this.captions.create(i, photo.name, width, height);
      group.add(edge, plane, outline, caption);
      group.position.set(slot.x, slot.y, slot.z);
      group.rotation.y = slot.rotationY;
      this.wall.add(group);
      const tile: Tile = {
        photo,
        group,
        plane,
        edge,
        outline,
        caption,
        home: group.position.clone(),
        rotation: group.quaternion.clone(),
        width,
        height,
        mix: 0,
        loaded: false,
        failed: false,
      };
      this.tiles.push(tile);
      if (animate) {
        group.visible = false;
        this.entries.push(tile);
      }
    }
    this.emit();
    this.loadVisible();
  }
  private loadVisible() {
    if (this.disposed) return;
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      ),
    );
    for (const t of this.tiles) {
      if (this.loadActive >= 2) break;
      if (t.loaded || t.failed || t.plane.userData.loading) continue;
      const p = t.group.getWorldPosition(new THREE.Vector3());
      if (
        !frustum.intersectsSphere(
          new THREE.Sphere(p, Math.max(t.width, t.height) * 0.6),
        ) &&
        !this.entries.includes(t)
      )
        continue;
      this.loadActive++;
      t.plane.userData.loading = true;
      void this.resources
        .load(t.photo)
        .then((texture) => {
          if (this.disposed) return;
          t.plane.material.uniforms.uMap.value = texture;
          t.plane.visible = true;
          t.loaded = true;
        })
        .catch(() => {
          t.failed = true;
          if (!this.disposed)
            this.onError(`“${t.photo.name}”图片加载失败，可在帮助中重试。`);
        })
        .finally(() => {
          this.loadActive--;
          t.plane.userData.loading = false;
          this.emit();
        });
    }
  }
  retryTextures() {
    for (const t of this.tiles) t.failed = false;
    this.loadVisible();
  }
  async openPhoto(id: string) {
    const t = this.tiles.find((t) => t.photo.id === id);
    if (!t || this.machine.busy || this.machine.state === "FOCUSED") return;
    try {
      if (!t.loaded) {
        const texture = await this.resources.load(t.photo);
        if (this.disposed) return;
        t.plane.material.uniforms.uMap.value = texture;
        t.plane.visible = true;
        t.loaded = true;
        t.failed = false;
      }
      this.entries = this.entries.filter((x) => x !== t);
      t.group.visible = true;
      this.pull(id);
    } catch {
      this.onError("照片暂时无法加载，请稍后重试。");
    }
  }
  private ensureParticles(t: Tile) {
    if (t.particles) return;
    const focused = this.machine.selected === t.photo.id;
    const distance = focused
      ? 6
      : Math.max(
          2,
          this.camera.position.z -
            t.group.getWorldPosition(new THREE.Vector3()).z,
        );
    const worldHeight =
      2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * distance;
    const scale = focused
      ? Math.min(
          this.focusBounds().height / t.height,
          this.focusBounds().width / t.width,
        )
      : t.group.scale.x;
    const pixelScale = this.host.clientHeight / worldHeight;
    const screenArea =
      (t.width * t.height * scale * scale * pixelScale * pixelScale) /
      (1920 * 1080 * 0.3);
    const count = Math.round(
      QUALITY[this.quality].particles *
        THREE.MathUtils.clamp(screenArea, 0.35, 1),
    );
    t.particles = createParticles(
      t.width,
      t.height,
      t.plane.material.uniforms.uMap.value,
      count,
      this.tiles.indexOf(t) + 42,
      this.reduced,
    );
    t.plane.material.uniforms.uGrid.value.set(
      t.particles.cols,
      t.particles.rows,
    );
    t.group.add(t.particles.points);
  }
  private clearParticles(t: Tile) {
    if (!t.particles) return;
    t.group.remove(t.particles.points);
    t.particles.points.geometry.dispose();
    t.particles.points.material.dispose();
    t.particles = undefined;
  }
  private setMix(t: Tile, v: number) {
    t.mix = v;
    t.plane.material.uniforms.uMix.value = v;
    t.edge.visible = v < 0.04;
    if (t.particles) {
      t.particles.points.visible = v > 0;
      t.particles.points.material.uniforms.uMix.value = v;
    }
  }
  private selected() {
    return this.tiles.find((t) => t.photo.id === this.machine.selected);
  }
  rotate(amount: number) {
    if (this.machine.busy || this.machine.state === "FOCUSED") return;
    this.lastInput = performance.now();
    this.gestureRotation.clear();
    this.speed = THREE.MathUtils.clamp(
      amount,
      -MOTION.maxSpeed,
      MOTION.maxSpeed,
    );
    this.machine.target(null);
  }
  rotateGesture(speed: number) {
    if (speed === 0) {
      this.gestureRotation.clear();
      if (this.gestureControl) this.speed = 0;
      return;
    }
    if (this.machine.busy || this.machine.state === "FOCUSED" || this.drag) {
      this.gestureRotation.clear();
      return;
    }
    this.gestureRotation.set(speed, performance.now(), this.reduced);
    if (speed) {
      this.lastInput = performance.now();
      this.speed = 0;
      this.machine.target(null);
    }
  }
  targetAt(x: number, y: number) {
    if (this.machine.busy || this.machine.state === "FOCUSED") return null;
    const rect = this.host.getBoundingClientRect();
    this.pointer.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      (-(y - rect.top) / rect.height) * 2 + 1,
    );
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visible = this.tiles.filter((t) => {
      const p = t.group.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
        t.group.getWorldQuaternion(new THREE.Quaternion()),
      );
      return (
        t.loaded &&
        t.group.visible &&
        p.z < this.camera.position.z &&
        normal.dot(this.camera.position.clone().sub(p).normalize()) > 0.15
      );
    });
    return (
      (this.raycaster.intersectObjects(
        visible.map((t) => t.plane),
        false,
      )[0]?.object.userData.id as string) || null
    );
  }
  target(id: string | null) {
    if (id) this.lastInput = performance.now();
    this.machine.target(id);
    this.emit();
  }
  pull(id: string) {
    const t = this.tiles.find((t) => t.photo.id === id);
    if (!t?.loaded || this.entry === t || !this.machine.pull(id)) return;
    this.speed = 0;
    this.lastInput = performance.now();
    this.ensureParticles(t);
    this.scene.attach(t.group);
    const startPos = t.group.position.clone(),
      startQ = t.group.quaternion.clone();
    this.focusTransform(t);
    const endPos = t.group.position.clone(),
      endScale = t.group.scale.x;
    t.group.position.copy(startPos);
    t.group.quaternion.copy(startQ);
    t.group.scale.setScalar(1);
    this.animation = {
      start: performance.now(),
      duration: this.reduced ? 700 : MOTION.travelMs,
      update: (p) => {
        const e = ease(p);
        t.group.position.lerpVectors(startPos, endPos, e);
        t.group.position.y += Math.sin(p * Math.PI) * (this.reduced ? 0 : 0.22);
        t.group.quaternion.slerpQuaternions(startQ, new THREE.Quaternion(), e);
        t.group.scale.setScalar(THREE.MathUtils.lerp(1, endScale, e));
        this.setMix(t, Math.sin(Math.PI * p) * 0.9);
      },
      finish: () => {
        this.focusTransform(t);
        this.setMix(t, 0);
        this.clearParticles(t);
        this.machine.arrived();
        this.emit();
      },
    };
    void this.resources
      .load(t.photo, true)
      .then((texture) => {
        if (this.disposed) return;
        if (this.machine.selected !== id) {
          this.resources.releaseFull(id);
          return;
        }
        t.plane.material.uniforms.uMap.value = texture;
        if (t.particles)
          t.particles.points.material.uniforms.uMap.value = texture;
      })
      .catch(() => {
        if (!this.disposed)
          this.onError("高清图加载失败，继续显示可用的缩略图。");
      });
    this.emit();
  }
  push() {
    const t = this.selected();
    if (!t || !this.machine.push()) return;
    this.ensureParticles(t);
    const from = t.group.position.clone(),
      fromQ = t.group.quaternion.clone(),
      fromScale = t.group.scale.x;
    const to = this.wall.localToWorld(t.home.clone()),
      toQ = this.wall
        .getWorldQuaternion(new THREE.Quaternion())
        .multiply(t.rotation);
    const initialMix = t.mix;
    this.animation = {
      start: performance.now(),
      duration: this.reduced ? 700 : MOTION.travelMs,
      update: (p) => {
        const e = ease(p);
        t.group.position.lerpVectors(from, to, e);
        t.group.quaternion.slerpQuaternions(fromQ, toQ, e);
        t.group.scale.setScalar(THREE.MathUtils.lerp(fromScale, 1, e));
        this.setMix(
          t,
          Math.max(initialMix * (1 - e), Math.sin(p * Math.PI) * 0.9),
        );
      },
      finish: () => {
        this.wall.attach(t.group);
        t.group.position.copy(t.home);
        t.group.quaternion.copy(t.rotation);
        t.group.scale.setScalar(1);
        this.setMix(t, 0);
        this.clearParticles(t);
        void this.resources.load(t.photo).then((texture) => {
          if (this.disposed) return;
          t.plane.material.uniforms.uMap.value = texture;
          this.resources.releaseFull(t.photo.id);
        });
        this.machine.arrived();
        this.lastInput = performance.now() - MOTION.idleDelayMs - 1;
        this.onReturn();
        this.emit();
      },
    };
    this.emit();
  }
  toggleParticles() {
    const t = this.selected();
    if (!t || !this.machine.toggleParticles()) return;
    this.ensureParticles(t);
    const from = t.mix,
      to = this.machine.particles === "DISSOLVING" ? 1 : 0;
    this.animation = {
      start: performance.now(),
      duration: MOTION.dissolveMs,
      update: (p) => this.setMix(t, THREE.MathUtils.lerp(from, to, ease(p))),
      finish: () => {
        this.setMix(t, to);
        this.machine.particles = to ? "DISPERSED" : "ASSEMBLED";
        if (!to) this.clearParticles(t);
        this.emit();
      },
    };
    this.emit();
  }
  private down = (e: PointerEvent) => {
    if (e.button !== 0 || this.machine.busy || this.machine.state === "FOCUSED")
      return;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.gestureRotation.clear();
    this.drag = {
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastTime: performance.now(),
      distance: 0,
    };
    this.speed = 0;
    this.lastInput = performance.now();
  };
  private move = (e: PointerEvent) => {
    const rect = this.host.getBoundingClientRect();
    this.parallax.set(
      ((e.clientX - rect.left) / rect.width - 0.5) * SPACE.parallax,
      (0.5 - (e.clientY - rect.top) / rect.height) * SPACE.parallax * 0.5,
    );
    if (this.drag) {
      const now = performance.now(),
        dx = e.clientX - this.drag.lastX;
      this.drag.distance = Math.max(
        this.drag.distance,
        Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y),
      );
      const inputDt = Math.max(
        0.008,
        Math.min(0.05, (now - this.drag.lastTime) / 1000),
      );
      this.wall.rotation.y -= THREE.MathUtils.clamp(
        dx * 0.0023,
        -MOTION.maxSpeed * inputDt,
        MOTION.maxSpeed * inputDt,
      );
      this.speed = THREE.MathUtils.clamp(
        (dx / Math.max(8, now - this.drag.lastTime)) * 0.75,
        -MOTION.maxSpeed,
        MOTION.maxSpeed,
      );
      this.drag.lastX = e.clientX;
      this.drag.lastTime = now;
      this.lastInput = now;
    } else {
      const id = this.targetAt(e.clientX, e.clientY);
      if (id !== this.machine.candidate) {
        this.machine.target(id);
        this.emit();
      }
      this.renderer.domElement.style.cursor = id ? "pointer" : "grab";
    }
  };
  private up = (e: PointerEvent) => {
    if (!this.drag) return;
    const click = this.drag.distance < 7;
    this.drag = null;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId))
      this.renderer.domElement.releasePointerCapture(e.pointerId);
    if (click) {
      const id = this.targetAt(e.clientX, e.clientY);
      if (id) this.pull(id);
    }
  };
  private cancel = () => {
    this.drag = null;
    this.speed = 0;
    this.gestureRotation.clear();
  };
  private leave = () => {
    this.parallax.set(0, 0);
    if (!this.drag) {
      this.machine.target(null);
      this.emit();
    }
  };
  private key = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.push();
  };
  private contextLost = (e: Event) => {
    e.preventDefault();
    this.contextUnavailable = true;
    this.syncRendering();
    this.onError("图形上下文暂时丢失，正在等待浏览器恢复；仍可使用界面。");
  };
  private contextRestored = () => {
    this.contextUnavailable = false;
    void this.environment.restore().catch(() => this.onError("环境光恢复失败，可重新选择空间主题重试。"));
    this.syncRendering();
  };
  private visibility = () => this.syncRendering();
  private syncRendering() {
    if (this.disposed) return;
    cancelAnimationFrame(this.frame);
    const now = performance.now();
    if (document.hidden || this.contextUnavailable) {
      if (this.pausedAt === null) this.pausedAt = now;
      this.cancel();
      return;
    }
    if (this.pausedAt !== null) {
      if (this.animation)
        this.animation.start +=
          now - Math.max(this.pausedAt, this.animation.start);
      if (this.entry)
        this.entryStart += now - Math.max(this.pausedAt, this.entryStart);
      this.lastInput += now - this.pausedAt;
      this.pausedAt = null;
    }
    this.previous = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.lastReport = now;
    this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    if (this.disposed || document.hidden || this.contextUnavailable) return;
    const rawDt = this.previous ? (now - this.previous) / 1000 : 0.016;
    const dt = Math.min(rawDt, 0.05);
    this.previous = now;
    this.frames++;
    this.elapsed += rawDt;
    if (!this.machine.busy && this.machine.state !== "FOCUSED" && !this.drag) {
      this.wall.rotation.y -= (this.speed + this.gestureRotation.step(now, dt)) * dt;
      this.speed *= Math.exp(-MOTION.damping * dt);
      if (
        this.autoOrbit && !this.gestureControl &&
        !this.reduced &&
        now - this.lastInput > MOTION.idleDelayMs &&
        !this.machine.candidate
      )
        this.wall.rotation.y -= MOTION.idleSpeed * dt;
    } else this.gestureRotation.clear();
    if (!this.machine.busy && this.machine.state !== "FOCUSED") {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.reduced ? 0 : this.parallax.x,
        2,
        dt,
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.reduced ? 0 : this.parallax.y,
        2,
        dt,
      );
    }
    if (this.animation) {
      const a = this.animation,
        p = Math.min(1, (now - a.start) / a.duration);
      a.update(p);
      if (p === 1) {
        this.animation = null;
        a.finish();
      }
    }
    if (!this.animation && !this.entry && this.entries.length) {
      const ready = this.entries.find((t) => t.loaded);
      if (ready) {
        this.entries = this.entries.filter((t) => t !== ready);
        this.entry = ready;
        this.entryStart = now;
        ready.group.visible = true;
        this.ensureParticles(ready);
        this.setMix(ready, 1);
      }
    }
    if (this.entry) {
      const p = Math.min(1, (now - this.entryStart) / MOTION.entryMs);
      this.setMix(this.entry, 1 - ease(p));
      if (p === 1) {
        this.clearParticles(this.entry);
        this.entry = null;
      }
    }
    const targetDim =
      this.machine.state === "FOCUSED" || this.machine.state === "PULLING"
        ? 0.012
        : 1;
    this.dim = THREE.MathUtils.damp(this.dim, targetDim, 4, dt);
    for (const t of this.tiles) {
      const focused = t.photo.id === this.machine.selected;
      const d = focused ? 1 : this.dim;
      t.plane.material.uniforms.uDim.value = d;
      t.caption.visible = !focused && t.loaded && t.mix < 0.02;
      t.caption.material.opacity = 0.85 * d;
      t.outline.material.opacity = THREE.MathUtils.damp(
        t.outline.material.opacity,
        t.photo.id === this.machine.candidate ? 0.75 : 0,
        9,
        dt,
      );
      if (t.particles) {
        t.particles.points.material.uniforms.uDim.value = d;
        t.particles.points.material.uniforms.uPixelScale.value =
          ((this.host.clientHeight * this.renderer.getPixelRatio()) /
            (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)))) *
          t.group.scale.x;
      }
    }
    if (!this.reduced) this.stars.rotation.y += dt * 0.002;
    const starMaterial = this.stars.material as THREE.ShaderMaterial;
    starMaterial.uniforms.uDim.value = this.dim;
    starMaterial.uniforms.uScale.value =
      this.host.clientHeight * this.renderer.getPixelRatio();
    this.environment.update(this.dim, rawDt, this.reduced);
    this.renderer.render(this.scene, this.camera);
    if (now - this.lastReport > 500) {
      this.emit(this.frames / Math.max(0.01, this.elapsed));
      this.frames = 0;
      this.elapsed = 0;
      this.lastReport = now;
      this.loadVisible();
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  snapshot(fps = 0): SceneSnapshot {
    return {
      environment: this.environment.snapshot(),
      state: this.machine.state,
      particles: this.machine.particles,
      selected: this.selected()?.photo || null,
      candidate:
        this.tiles.find((t) => t.photo.id === this.machine.candidate)?.photo ||
        null,
      fps,
      count: this.tiles.length,
      loaded: this.tiles.filter((t) => t.loaded).length,
      quality: this.quality,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
      drawCalls: this.renderer.info.render.calls,
      wallAngle: this.wall.rotation.y,
      firstPhotoScreenX: this.tiles[0]
        ? this.tiles[0].group
            .getWorldPosition(new THREE.Vector3())
            .project(this.camera).x
        : 0,
      firstPhotoScreenY: this.tiles[0]
        ? this.tiles[0].group
            .getWorldPosition(new THREE.Vector3())
            .project(this.camera).y
        : 0,
      orbiting:
        this.autoOrbit && !this.gestureControl &&
        !this.reduced &&
        !this.machine.busy &&
        this.machine.state !== "FOCUSED" &&
        !this.drag &&
        !this.machine.candidate &&
        performance.now() - this.lastInput > MOTION.idleDelayMs,
      homeError: Math.max(
        0,
        ...this.tiles
          .filter((t) => t.group.parent === this.wall)
          .map(
            (t) =>
              t.group.position.distanceTo(t.home) +
              t.group.quaternion.angleTo(t.rotation) +
              Math.abs(t.group.scale.x - 1),
          ),
      ),
    };
  }
  private emit(fps = 0) {
    if (!this.disposed) this.onChange(this.snapshot(fps));
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.removeEventListener("keydown", this.key);
    document.removeEventListener("visibilitychange", this.visibility);
    const c = this.renderer.domElement;
    c.removeEventListener("pointerdown", this.down);
    c.removeEventListener("pointermove", this.move);
    c.removeEventListener("pointerup", this.up);
    c.removeEventListener("pointercancel", this.cancel);
    c.removeEventListener("pointerleave", this.leave);
    c.removeEventListener("webglcontextlost", this.contextLost);
    c.removeEventListener("webglcontextrestored", this.contextRestored);
    for (const t of this.tiles) {
      this.clearParticles(t);
      t.plane.geometry.dispose();
      t.plane.material.dispose();
      t.edge.geometry.dispose();
      t.edge.material.dispose();
      t.outline.geometry.dispose();
      t.outline.material.dispose();
      t.caption.geometry.dispose();
      t.caption.material.dispose();
    }
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.resources.dispose();
    this.environment.dispose();
    this.captions.dispose();
    this.renderer.dispose();
    c.remove();
  }
}
