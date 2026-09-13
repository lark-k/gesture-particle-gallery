import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { THEMES, type ThemeId } from './themes';

interface EnvironmentBundle {
  group: THREE.Group;
  backdrop: THREE.MeshBasicMaterial;
  sprites: THREE.SpriteMaterial[];
  maps: THREE.Texture[];
  lighting: THREE.WebGLRenderTarget | null;
}

/** Art-directed panorama on a distant curved cyclorama; separate, radiometric
 * HDR supplies PBR illumination. Foreground cutouts have independent parallax. */
export class NaturalEnvironment {
  readonly group = new THREE.Group();
  private current?: EnvironmentBundle;
  private previous?: EnvironmentBundle;
  private sequence = 0;
  private disposed = false;
  private fade = 1;
  private active: ThemeId | null = null;
  private verticalStretch = 1;
  private pmrem: THREE.PMREMGenerator;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  snapshot() {
    return { theme: this.active, ready: !!this.current && this.fade === 1, hdrReady: !!this.current?.lighting };
  }

  async setTheme(id: ThemeId): Promise<boolean> {
    const sequence = ++this.sequence;
    // Reload even the active theme: retry must repair missing HDR / sprite assets.
    const results = await Promise.allSettled([
      new THREE.TextureLoader().loadAsync(`/environments/${id}-panorama.jpg`),
      new THREE.TextureLoader().loadAsync(`/environments/${id}-foreground.png`),
      new HDRLoader().loadAsync(`/environments/${id}-light.hdr`),
    ]);
    const maps = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    if (this.disposed || sequence !== this.sequence) {
      maps.forEach(t => t.dispose());
      return false;
    }
    if (results[0].status === 'rejected') {
      maps.forEach(t => t.dispose());
      throw new Error('环境图片加载失败，请重试；当前场景已保留。');
    }
    const panorama = results[0].value;
    panorama.colorSpace = THREE.SRGBColorSpace;
    panorama.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const group = new THREE.Group();
    const backdrop = new THREE.MeshBasicMaterial({
      map: panorama, side: THREE.BackSide, depthWrite: false,
      transparent: true, opacity: 0, toneMapped: false,
    });
    // 208-degree visual arc covers all supported camera aspects. It does not
    // masquerade as a radiometric HDR or as a physically measured 360 panorama.
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(58, 58, 82, 96, 1, true, Math.PI * .42, Math.PI * 1.16),
      backdrop,
    );
    cylinder.renderOrder = -100;
    cylinder.scale.y = this.verticalStretch;
    group.add(cylinder);
    const sprites: THREE.SpriteMaterial[] = [];
    if (results[1].status === 'fulfilled') {
      const map = results[1].value;
      map.colorSpace = THREE.SRGBColorSpace;
      for (const [x, y, z, size, mirror] of [[-8.5,-5.9,-4,9,1],[12,-6.8,-10,8,-1]]) {
        const material = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x,y,z);
        sprite.scale.set(size * mirror, size * map.image.height / map.image.width, 1);
        group.add(sprite);
        sprites.push(material);
      }
    }
    let lighting: THREE.WebGLRenderTarget | null = null;
    if (results[2].status === 'fulfilled') {
      const hdr = results[2].value;
      try { lighting = this.pmrem.fromEquirectangular(hdr); }
      catch { /* Visible environment and unlit photographs remain usable. */ }
      hdr.dispose();
      maps.splice(maps.indexOf(hdr), 1);
    }
    if (this.previous) this.release(this.previous);
    this.previous = this.current;
    if (this.previous) {
      this.previous.group.traverse(o => { if (o instanceof THREE.Mesh) o.renderOrder = -101; });
    }
    this.current = { group, backdrop, sprites, maps, lighting };
    this.group.add(group);
    this.scene.environment = lighting?.texture ?? null;
    this.scene.environmentIntensity = THEMES[id].intensity;
    this.active = id;
    this.fade = 0;
    return results.every(r => r.status === 'fulfilled') && !!lighting;
  }

  update(dim: number, dt: number, reduced: boolean) {
    this.fade = Math.min(1, this.fade + dt / (reduced ? .12 : .85));
    const brightness = THREE.MathUtils.lerp(.004, 1, dim);
    for (const bundle of [this.previous, this.current]) {
      if (!bundle) continue;
      bundle.backdrop.color.setScalar(brightness);
      bundle.backdrop.opacity = bundle === this.current ? this.fade : 1;
      bundle.sprites.forEach(m => {
        m.opacity = (bundle === this.current ? this.fade : 1 - this.fade) * dim * .8;
      });
    }
    if (this.fade === 1 && this.previous) {
      this.release(this.previous);
      this.previous = undefined;
    }
  }

  resize(aspect: number) {
    this.verticalStretch = aspect < .8 ? 1.7 : 1;
    for (const bundle of [this.current, this.previous]) {
      bundle?.group.traverse(o => { if (o instanceof THREE.Mesh) o.scale.y = this.verticalStretch; });
    }
  }

  restore() {
    this.pmrem.dispose();
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    if (this.active) return this.setTheme(this.active);
    return Promise.resolve(true);
  }

  private release(bundle: EnvironmentBundle) {
    this.group.remove(bundle.group);
    bundle.group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    bundle.backdrop.dispose();
    bundle.sprites.forEach(m => m.dispose());
    bundle.maps.forEach(t => t.dispose());
    bundle.lighting?.dispose();
  }

  dispose() {
    this.disposed = true;
    this.sequence++;
    this.scene.environment = null;
    if (this.current) this.release(this.current);
    if (this.previous) this.release(this.previous);
    this.pmrem.dispose();
  }
}
