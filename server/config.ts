import "dotenv/config";
export interface Config {
  production: boolean;
  origin: string;
  database: string;
  port: number;
  region: string;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  stsToken: string;
  adminUsername: string;
  adminPasswordHash: string;
  inviteCode: string;
  registrationOpen: boolean;
  maxBytes: number;
  maxPhotos: number;
  trustProxy: boolean;
}
export function getConfig(): Config {
  const production = process.env.NODE_ENV === "production";
  const c = {
    production,
    origin: process.env.APP_ORIGIN || "http://localhost:5188",
    database: process.env.DATABASE_PATH || "./data/gallery.sqlite",
    port: Number(process.env.PORT || 3188),
    region: process.env.OSS_REGION || "oss-cn-hangzhou",
    endpoint: process.env.OSS_ENDPOINT || "",
    bucket: process.env.OSS_BUCKET || "",
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
    stsToken: process.env.OSS_STS_TOKEN || "",
    adminUsername: process.env.ADMIN_USERNAME || "curator",
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || "",
    inviteCode: process.env.REGISTRATION_INVITE_CODE || "",
    registrationOpen:
      !production && process.env.DEV_OPEN_REGISTRATION !== "false",
    maxBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
    maxPhotos: Number(process.env.MAX_PHOTOS || 120),
    trustProxy: process.env.TRUST_PROXY === "1",
  };
  if (
    [c.bucket, c.accessKeyId, c.accessKeySecret].some(Boolean) &&
    ![c.bucket, c.accessKeyId, c.accessKeySecret].every(Boolean)
  )
    throw new Error("OSS 配置不完整；请完整配置或全部留空。");
  if (production && !c.origin.startsWith("https://"))
    throw new Error("生产环境 APP_ORIGIN 必须为 HTTPS。");
  if (c.endpoint) {
    const endpoint = new URL(c.endpoint);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== `${c.region}.aliyuncs.com` ||
      endpoint.port || endpoint.username || endpoint.password ||
      endpoint.pathname !== "/" || endpoint.search || endpoint.hash
    )
      throw new Error("OSS_ENDPOINT 必须为与 OSS_REGION 一致的 HTTPS 地域端点。");
  }
  if (production && !c.bucket)
    throw new Error("生产环境必须配置 OSS 存储。");
  if (
    !Number.isFinite(c.maxBytes) ||
    c.maxBytes < 1024 ||
    c.maxBytes > 30 * 1024 * 1024 ||
    !Number.isInteger(c.maxPhotos) ||
    c.maxPhotos < 1 ||
    c.maxPhotos > 120
  )
    throw new Error("MAX_UPLOAD_MB 需在 0.001–30，MAX_PHOTOS 需在 1–120。");
  return c;
}
