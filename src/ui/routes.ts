export type PageRoute = { page: "home" | "albums" | "demo" | "gallery" | "missing"; albumId: string | null };

export function resolveRoute(path: string): PageRoute {
  if (path === "/") return { page: "home", albumId: null };
  if (/^\/albums\/?$/.test(path)) return { page: "albums", albumId: null };
  if (/^\/demo\/?$/.test(path)) return { page: "demo", albumId: null };
  const album = path.match(/^\/albums\/([a-zA-Z0-9-]+)\/?$/);
  return album ? { page: "gallery", albumId: album[1] } : { page: "missing", albumId: null };
}
