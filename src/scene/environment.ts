import * as THREE from "three";

/** A single atlas for the default sample photos' wall captions. */
export class PhotoCaptions {
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  constructor() {
    this.canvas.width = 2048;
    this.canvas.height = 2304;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }
  create(index: number, name: string, width: number, height: number) {
    const col = index % 4,
      row = Math.floor(index / 4),
      x = col * 512,
      y = row * 64;
    this.ctx.fillStyle = "#c6bca6";
    this.ctx.font = "20px 'Segoe UI', sans-serif";
    this.ctx.fillText(String(index + 1).padStart(2, "0"), x + 3, y + 29);
    this.ctx.fillStyle = "#b6c0c5";
    this.ctx.font = "20px 'Microsoft YaHei', sans-serif";
    this.ctx.fillText(
      name.length > 18 ? name.slice(0, 17) + "…" : name,
      x + 54,
      y + 29,
      445,
    );
    this.texture.needsUpdate = true;
    const w = Math.min(width, 5.5),
      geometry = new THREE.PlaneGeometry(w, w / 8);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++)
      uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 36);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0.85,
      alphaTest: 0.05,
      depthWrite: true,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((w - width) / 2, -height / 2 - w / 16 - 0.14, 0.025);
    return mesh;
  }
  dispose() {
    this.texture.dispose();
    this.canvas.width = this.canvas.height = 1;
  }
}
