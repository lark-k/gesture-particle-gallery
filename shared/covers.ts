export const ALBUM_COVERS = [
  { id: "meadow", name: "花开的日子", url: "/album-covers/meadow.webp" },
  { id: "coast", name: "海风来信", url: "/album-covers/coast.webp" },
  { id: "cat", name: "午后小憩", url: "/album-covers/cat.webp" },
  { id: "forest", name: "林间晨光", url: "/environments/forest-panorama.jpg" },
  { id: "lake", name: "静水流深", url: "/environments/lake-panorama.jpg" },
  { id: "linen", name: "素色留白", url: "/album-covers/linen.webp" },
] as const;
export const presetCover = (id: string) => ALBUM_COVERS.find(c => c.id === id) || ALBUM_COVERS[0];
