import * as THREE from "three";
import type { Photo } from "../../shared/types";
import { api } from "../upload/client";
export class PhotoResources {
  private disposed = false;
  private textures = new Map<string, THREE.Texture>();
  private pending = new Map<string, Promise<THREE.Texture>>();
  private loader = new THREE.TextureLoader();
  constructor(private maxAnisotropy: number) {
    this.loader.setCrossOrigin("anonymous");
  }
  async load(photo: Photo, full = false): Promise<THREE.Texture> {
    const key = photo.id + (full ? ":full" : ":thumb");
    if (this.textures.has(key)) return this.textures.get(key)!;
    if (this.pending.has(key)) return this.pending.get(key)!;
    const promise = (async () => {
      if (
        photo.source === "oss" &&
        (!photo.expiresAt ||
          photo.expiresAt < Date.now() + 60000 ||
          (full && !photo.fullUrl))
      )
        Object.assign(
          photo,
          await api(
            `/api/photos/${photo.id}/read?size=${Math.min(2400, Math.ceil(Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio, 2)))}`,
          ),
        );
      let texture: THREE.Texture;
      try {
        texture = await this.loader.loadAsync(
          full ? photo.fullUrl || photo.thumbUrl : photo.thumbUrl,
        );
      } catch (e) {
        if (photo.source !== "oss") throw e;
        Object.assign(photo, await api(`/api/photos/${photo.id}/read`));
        texture = await this.loader.loadAsync(
          full ? photo.fullUrl || photo.thumbUrl : photo.thumbUrl,
        );
      }
      if (this.disposed) {
        texture.dispose();
        throw new Error("场景已关闭");
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.maxAnisotropy;
      this.textures.set(key, texture);
      return texture;
    })();
    this.pending.set(key, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(key);
    }
  }
  releaseFull(id: string) {
    const key = id + ":full";
    this.textures.get(key)?.dispose();
    this.textures.delete(key);
  }
  dispose() {
    this.disposed = true;
    this.textures.forEach((t) => t.dispose());
    this.textures.clear();
  }
}
