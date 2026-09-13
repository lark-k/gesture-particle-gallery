import type { Photo } from "../../shared/types";
export interface User {
  id: string;
  username: string;
}
export interface AppConfig {
  mode: "local" | "oss";
  maxBytes: number;
  maxPhotos: number;
  registration: "open" | "invite" | "closed";
  user: User | null;
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let activeAccountId: string | null = null;
export function setActiveAccount(id: string | null) {
  activeAccountId = id;
}
export async function api<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(activeAccountId && !/^\/api\/(auth\/|config|health)/.test(path)
        ? { "X-Account-ID": activeAccountId }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await res
    .json()
    .catch(() => ({ error: "服务响应无效，请检查后端是否启动。" }));
  if (!res.ok) {
    if (data.code === "ACCOUNT_CHANGED" && typeof window !== "undefined")
      window.dispatchEvent(new Event("stillspace:session-changed"));
    throw new ApiError(data.error || `请求失败 (${res.status})`, res.status);
  }
  return data;
}
export interface PreparedPhoto {
  file: File;
  preview: string;
  local: Photo;
  revoke: () => void;
  uploadedGrant?: Grant;
}
export async function preparePhoto(
  file: File,
  maxBytes: number,
): Promise<PreparedPhoto> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("仅支持 JPG、PNG、WebP 静态照片。");
  if (file.size < 1 || file.size > maxBytes)
    throw new Error(`文件需小于 ${Math.round(maxBytes / 1024 / 1024)} MB。`);
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    if (bitmap.width * bitmap.height > 40000000)
      throw new Error("照片不能超过 4000 万像素。");
    const encode = async (max: number) => {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("图片预览生成失败"))),
          "image/jpeg",
          0.91,
        ),
      );
    };
    // Finish both encodes before creating URLs so a second encode failure cannot leak the first URL.
    const thumbBlob = await encode(800),
      fullBlob = await encode(2400);
    const thumb = URL.createObjectURL(thumbBlob),
      full = URL.createObjectURL(fullBlob);
    return {
      file,
      preview: thumb,
      local: {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        width: bitmap.width,
        height: bitmap.height,
        thumbUrl: thumb,
        fullUrl: full,
        source: "local",
        createdAt: new Date().toISOString(),
      },
      revoke: () => {
        URL.revokeObjectURL(thumb);
        URL.revokeObjectURL(full);
      },
    };
  } finally {
    bitmap.close();
  }
}
interface Grant {
  uploadId: string;
  host: string;
  fields: Record<string, string>;
  expiresAt: number;
}
function directUpload(
  grant: Grant,
  file: File,
  progress: (v: number) => void,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    const finish = () => signal.removeEventListener("abort", abort);
    xhr.open("POST", grant.host);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        progress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
    };
    xhr.onload = () => {
      finish();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const code = xhr.responseText.match(/<Code>([^<]+)<\/Code>/)?.[1];
        reject(
          new Error(
            `OSS 上传失败 (${xhr.status}${code ? ` / ${code}` : ""})，请检查授权、网络与 CORS。`,
          ),
        );
      }
    };
    xhr.onerror = () => {
      finish();
      reject(new Error("无法连接 OSS，请检查网络及 Bucket CORS。"));
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error("上传超时，请重试。"));
    };
    xhr.onabort = () => {
      finish();
      reject(new DOMException("上传已取消", "AbortError"));
    };
    const form = new FormData();
    Object.entries(grant.fields).forEach(([k, v]) => form.append(k, v));
    form.append("file", file);
    if (signal.aborted) {
      finish();
      reject(new DOMException("已取消", "AbortError"));
    } else xhr.send(form);
  });
}
export async function uploadPhoto(
  prepared: PreparedPhoto,
  progress: (n: number, label: string) => void,
  signal: AbortSignal,
): Promise<Photo> {
  let grant = prepared.uploadedGrant;
  if (!grant) {
    progress(0, "申请上传授权");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await prepared.file.arrayBuffer(),
    );
    const sha256 = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    grant = await api<Grant>(
      "/api/uploads/authorize",
      {
        name: prepared.local.name.slice(0, 150),
        mime: prepared.file.type,
        size: prepared.file.size,
        sha256,
      },
      signal,
    );
    try {
      await directUpload(
        grant,
        prepared.file,
        (v) => progress(v, "上传至私有 OSS"),
        signal,
      );
    } catch (e) {
      await api(`/api/uploads/${grant.uploadId}/cancel`, {}).catch(() => {});
      throw e;
    }
    prepared.uploadedGrant = grant;
  }
  progress(96, "校验文件并生成缩略图");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await api<Photo>(
        `/api/uploads/${grant.uploadId}/complete`,
        {},
        signal,
      );
      progress(100, "已保存至私有 OSS");
      prepared.uploadedGrant = undefined;
      return result;
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof ApiError && [404, 410, 422].includes(e.status)) {
        prepared.uploadedGrant = undefined;
        await api(`/api/uploads/${grant.uploadId}/cancel`, {}).catch(() => {});
        throw e;
      }
      if (e instanceof ApiError && ![429, 500, 502, 503].includes(e.status))
        throw e;
      if (attempt === 2) throw e;
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("已取消", "AbortError"));
          return;
        }
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("已取消", "AbortError"));
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          1000 * (attempt + 1),
        );
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
  throw new Error("上传完成校验失败");
}
