import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { resolve } from "node:path";
import {
  openDatabase,
  type PhotoRow,
  type UploadRow,
  type UserRow,
  type AlbumRow,
} from "./db";
import { ALBUM_COVERS, presetCover } from "../shared/covers";
import { equalSecret, passwordHash, tokenHash, verifyPassword } from "./auth";
import { OSSStorage, type Storage } from "./storage";
import type { Config } from "./config";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createApp(config: Config, injectedStorage?: Storage) {
  const db = openDatabase(config.database),
    app = express();
  const storage =
    injectedStorage || (config.bucket ? new OSSStorage(config) : null);
  const completing = new Set<string>();
  if (config.adminPasswordHash) {
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(config.adminPasswordHash))
      throw new Error(
        "ADMIN_PASSWORD_HASH 格式错误，使用 npm run password 生成。",
      );
    db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?)").run(
      randomUUID(),
      config.adminUsername,
      config.adminPasswordHash,
      Date.now(),
    );
  }
  if (
    config.production &&
    !db.prepare("SELECT id FROM users LIMIT 1").get() &&
    !config.inviteCode
  )
    throw new Error(
      "首次生产启动请设置 ADMIN_PASSWORD_HASH 或 REGISTRATION_INVITE_CODE。",
    );
  if (config.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          workerSrc: ["'self'", "blob:"],
          imgSrc: [
            "'self'",
            "blob:",
            "data:",
            ...(config.bucket
              ? [`https://${config.bucket}.${config.region}.aliyuncs.com`]
              : []),
          ],
          connectSrc: [
            "'self'",
            ...(config.bucket
              ? [`https://${config.bucket}.${config.region}.aliyuncs.com`]
              : []),
          ],
          styleSrc: ["'self'", "'unsafe-inline'"],
          mediaSrc: ["'self'", "blob:"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: "24kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", (req, _res, next) => {
    if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
      if (req.get("origin") !== config.origin || !req.is("application/json"))
        return next(new HttpError(403, "请求来源或格式不正确。"));
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "请求过于频繁，请稍后重试。" },
    }),
  );
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 25,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "登录或注册尝试过多，请 15 分钟后重试。" },
  });
  const user = (req: express.Request): UserRow | null => {
    const token = req.cookies?.session;
    if (typeof token !== "string" || token.length !== 64) return null;
    return (
      (db
        .prepare(
          "SELECT u.id,u.username,u.password_hash FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?",
        )
        .get(tokenHash(token), Date.now()) as unknown as UserRow) || null
    );
  };
  const requireUser = (req: express.Request) => {
    const u = user(req);
    if (!u) throw new HttpError(401, "请先登录。");
    if (req.get("X-Account-ID") && req.get("X-Account-ID") !== u.id) {
      const error = new HttpError(
        409,
        "账户已在其他标签页切换，正在刷新当前空间。",
      );
      Object.assign(error, { code: "ACCOUNT_CHANGED" });
      throw error;
    }
    return u;
  };
  const issueSession = (res: express.Response, u: UserRow) => {
    const token = randomBytes(32).toString("hex");
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      tokenHash(token),
      u.id,
      Date.now() + 7 * 86400000,
    );
    res.cookie("session", token, {
      httpOnly: true,
      secure: config.production,
      sameSite: "strict",
      maxAge: 7 * 86400000,
      path: "/",
    });
    return { id: u.id, username: u.username };
  };
  const dto = async (p: PhotoRow, size = 1920) => ({
    id: p.id,
    albumId: p.album_id,
    name: p.name,
    width: p.width,
    height: p.height,
    createdAt: p.created_at,
    source: "oss",
    objectKey: p.object_key,
    thumbKey: p.thumb_key,
    thumbUrl: await storage!.read(p.thumb_key),
    fullUrl: await storage!.read(p.display_key, size),
    expiresAt: Date.now() + 900000,
  });
  const albumFor = (id: unknown, owner: string) => {
    if (typeof id !== "string" || !id) throw new HttpError(400, "请先选择一个相册集。");
    const album = db.prepare("SELECT * FROM albums WHERE id=? AND user_id=?").get(id, owner) as unknown as AlbumRow;
    if (!album) throw new HttpError(404, "相册集不存在或无权访问。");
    return album;
  };
  const albumDto = async (a: AlbumRow) => {
    const cover = a.cover_photo_id ? db.prepare("SELECT * FROM photos WHERE id=? AND album_id=? AND user_id=?")
      .get(a.cover_photo_id, a.id, a.user_id) as unknown as PhotoRow | undefined : undefined;
    return {
      id: a.id, name: a.name, description: a.description, coverPreset: a.cover_preset,
      coverPhotoId: cover?.id || null, coverX: a.cover_x, coverY: a.cover_y,
      coverUrl: cover && storage ? await storage.read(cover.thumb_key) : presetCover(a.cover_preset).url,
      photoCount: (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE album_id=? AND user_id=?").get(a.id, a.user_id) as { n: number }).n,
      createdAt: a.created_at, updatedAt: a.updated_at,
    };
  };
  // Persist failed object deletions so a storage outage cannot lose cleanup work.
  let cleaning = false;
  const cleanStorage = async () => {
    if (!storage || cleaning) return;
    cleaning = true;
    try {
      for (const row of db.prepare("SELECT object_key FROM storage_cleanup LIMIT 500").all()) {
        try {
          await storage.delete(String(row.object_key));
          db.prepare("DELETE FROM storage_cleanup WHERE object_key=?").run(row.object_key);
        } catch { /* Retried on the next list/delete request or server start. */ }
      }
    } finally { cleaning = false; }
  };
  void cleanStorage();
  const validateAlbum = (body: Record<string, unknown>, current?: AlbumRow) => {
    const name = typeof body.name === "string" ? body.name.trim() : current?.name;
    const description = body.description === undefined ? current?.description || "" : body.description;
    const preset = body.coverPreset === undefined ? current?.cover_preset || "meadow" : body.coverPreset;
    const x = body.coverX === undefined ? current?.cover_x ?? 50 : body.coverX;
    const y = body.coverY === undefined ? current?.cover_y ?? 50 : body.coverY;
    if (!name || name.length > 60 || typeof description !== "string" || description.length > 240 ||
      !ALBUM_COVERS.some(c => c.id === preset) || typeof x !== "number" || typeof y !== "number" ||
      !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100)
      throw new HttpError(400, "名称需为 1–60 字，简介最多 240 字，请选择有效封面。");
    return { name, description, preset: String(preset), x, y };
  };
  app.get("/api/albums", async (req, res) => {
    const u = requireUser(req);
    const rows = db.prepare("SELECT * FROM albums WHERE user_id=? ORDER BY position,created_at,id").all(u.id) as unknown as AlbumRow[];
    res.json({ albums: await Promise.all(rows.map(albumDto)), totalPhotos:
      (db.prepare("SELECT COUNT(*) AS n FROM photos WHERE user_id=?").get(u.id) as { n: number }).n });
    void cleanStorage();
  });
  app.post("/api/albums", async (req, res) => {
    const u = requireUser(req), fields = validateAlbum(req.body || {});
    const id = randomUUID(), now = new Date().toISOString();
    const position = (db.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM albums WHERE user_id=?").get(u.id) as { n: number }).n;
    db.prepare(`INSERT INTO albums(id,user_id,name,description,cover_preset,cover_x,cover_y,position,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,u.id,fields.name,fields.description,fields.preset,fields.x,fields.y,position,now,now);
    res.status(201).json(await albumDto(albumFor(id,u.id)));
  });
  app.get("/api/albums/:id", async (req,res) => res.json(await albumDto(albumFor(req.params.id,requireUser(req).id))));
  app.get("/api/albums/:id/photos", async (req,res) => {
    const u = requireUser(req), a = albumFor(req.params.id,u.id);
    const rows = db.prepare("SELECT * FROM photos WHERE album_id=? AND user_id=? ORDER BY created_at,id")
      .all(a.id,u.id) as unknown as PhotoRow[];
    res.json({ photos: storage ? await Promise.all(rows.map(p => dto(p))) : [] });
  });
  app.patch("/api/albums/:id", async (req,res) => {
    const u = requireUser(req), a = albumFor(req.params.id,u.id), body = req.body || {};
    const fields = validateAlbum(body,a);
    const photoId = body.coverPhotoId === undefined ? a.cover_photo_id : body.coverPhotoId;
    if (photoId !== null && (typeof photoId !== "string" || !db.prepare("SELECT id FROM photos WHERE id=? AND album_id=? AND user_id=?").get(photoId,a.id,u.id)))
      throw new HttpError(400,"请使用当前相册集中的照片作为封面。");
    db.prepare("UPDATE albums SET name=?,description=?,cover_preset=?,cover_photo_id=?,cover_x=?,cover_y=?,updated_at=? WHERE id=? AND user_id=?")
      .run(fields.name,fields.description,fields.preset,photoId,fields.x,fields.y,new Date().toISOString(),a.id,u.id);
    res.json(await albumDto(albumFor(a.id,u.id)));
  });
  app.post("/api/albums/:id/feature", async (req,res) => {
    const u = requireUser(req), a = albumFor(req.params.id,u.id);
    db.prepare("UPDATE albums SET position=(SELECT COALESCE(MIN(position),0)-1 FROM albums WHERE user_id=?) WHERE id=? AND user_id=?")
      .run(u.id,a.id,u.id);
    res.json({ok:true});
  });
  app.delete("/api/albums/:id", async (req,res) => {
    const u = requireUser(req), a = albumFor(req.params.id,u.id);
    const tickets = db.prepare("SELECT * FROM uploads WHERE album_id=? AND user_id=?").all(a.id,u.id) as unknown as UploadRow[];
    if (tickets.some(t => completing.has(t.id))) throw new HttpError(409,"相册中有照片正在完成上传，请稍后再删除。");
    const photos = db.prepare("SELECT * FROM photos WHERE album_id=? AND user_id=?").all(a.id,u.id) as unknown as PhotoRow[];
    db.exec("BEGIN IMMEDIATE");
    try {
      const enqueue = db.prepare("INSERT OR IGNORE INTO storage_cleanup VALUES(?)");
      for (const p of photos) for (const key of [p.object_key,p.display_key,p.thumb_key]) enqueue.run(key);
      for (const t of tickets) enqueue.run(t.object_key);
      db.prepare("DELETE FROM uploads WHERE album_id=? AND user_id=?").run(a.id,u.id);
      db.prepare("DELETE FROM photos WHERE album_id=? AND user_id=?").run(a.id,u.id);
      db.prepare("DELETE FROM albums WHERE id=? AND user_id=?").run(a.id,u.id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    await cleanStorage();
    res.json({ok:true});
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/config", (req, res) => {
    const u = user(req);
    res.json({
      mode: storage ? "oss" : "local",
      maxBytes: config.maxBytes,
      maxPhotos: config.maxPhotos,
      registration: config.registrationOpen
        ? "open"
        : config.inviteCode
          ? "invite"
          : "closed",
      user: u ? { id: u.id, username: u.username } : null,
    });
  });
  app.post("/api/auth/register", authLimit, async (req, res) => {
    const { username, password, inviteCode } = req.body || {};
    if (
      !config.registrationOpen &&
      (!config.inviteCode ||
        typeof inviteCode !== "string" ||
        !equalSecret(inviteCode, config.inviteCode))
    )
      throw new HttpError(403, "注册需要有效邀请码，请联系管理员。");
    if (
      typeof username !== "string" ||
      !/^[\p{L}\p{N}_-]{3,32}$/u.test(username) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      throw new HttpError(400, "用户名 3–32 位；密码需 12–128 位。");
    if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
      throw new HttpError(409, "用户名已存在。");
    const u = {
      id: randomUUID(),
      username,
      password_hash: await passwordHash(password),
    };
    try {
      db.prepare("INSERT INTO users VALUES(?,?,?,?)").run(
        u.id,
        u.username,
        u.password_hash,
        Date.now(),
      );
    } catch {
      throw new HttpError(409, "用户名已存在。");
    }
    res.status(201).json({ user: issueSession(res, u) });
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const { username, password } = req.body || {};
    if (
      typeof username !== "string" ||
      typeof password !== "string" ||
      password.length > 128 ||
      username.length > 32
    )
      throw new HttpError(400, "请填写用户名和密码。");
    const u = db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(username) as unknown as UserRow;
    const dummy = "00000000000000000000000000000000:" + "0".repeat(128);
    if (!(await verifyPassword(password, u?.password_hash || dummy)) || !u)
      throw new HttpError(401, "用户名或密码错误。");
    if (req.cookies.session)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        tokenHash(req.cookies.session),
      );
    res.json({ user: issueSession(res, u) });
  });
  app.post("/api/auth/logout", (req, res) => {
    if (typeof req.cookies.session === "string")
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        tokenHash(req.cookies.session),
      );
    res.clearCookie("session", { path: "/" });
    res.json({ ok: true });
  });
  app.get("/api/photos", async (req, res) => {
    const u = requireUser(req);
    const rows = db
      .prepare(
        "SELECT * FROM photos WHERE user_id=? ORDER BY created_at,id LIMIT ?",
      )
      .all(u.id, config.maxPhotos) as unknown as PhotoRow[];
    res.json({ photos: await Promise.all(rows.map((p) => dto(p))) });
  });
  app.get("/api/photos/:id/read", async (req, res) => {
    const u = requireUser(req);
    const p = db
      .prepare("SELECT * FROM photos WHERE id=? AND user_id=?")
      .get(String(req.params.id), u.id) as unknown as PhotoRow;
    if (!p || !storage) throw new HttpError(404, "照片不存在或无权访问。");
    const size = Math.min(2400, Math.max(800, Number(req.query.size) || 1920));
    res.json(await dto(p, Math.round(size)));
  });
  app.post("/api/uploads/authorize", (req, res) => {
    const u = requireUser(req);
    if (!storage)
      throw new HttpError(409, "当前为本地演示模式，没有上传到 OSS。");
    const { name, mime, size, sha256, albumId } = req.body || {};
    if (
      typeof name !== "string" ||
      name.length < 1 ||
      name.length > 150 ||
      !["image/jpeg", "image/png", "image/webp"].includes(mime) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > config.maxBytes ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new HttpError(400, "文件格式、大小或校验值不正确。");
    const album = albumFor(albumId, u.id);
    const n = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM photos WHERE user_id=?) + (SELECT COUNT(*) FROM uploads WHERE user_id=? AND photo_id IS NULL AND expires>?) AS n",
      )
      .get(u.id, u.id, Date.now()) as { n: number };
    if (n.n >= config.maxPhotos)
      throw new HttpError(
        429,
        `每个账户最多 ${config.maxPhotos} 张照片（包含待完成上传）。`,
      );
    const active = db
      .prepare(
        "SELECT COUNT(*) AS n FROM uploads WHERE user_id=? AND photo_id IS NULL AND expires>?",
      )
      .get(u.id, Date.now()) as { n: number };
    if (active.n >= 3) throw new HttpError(429, "已有待完成上传，请稍候重试。");
    const id = randomUUID(),
      key = `staging/${u.id}/${id}`;
    const grant = storage.grant(key, mime, size);
    db.prepare("INSERT INTO uploads(id,user_id,object_key,name,mime,size,sha256,expires,photo_id,album_id) VALUES(?,?,?,?,?,?,?,?,NULL,?)").run(
      id,
      u.id,
      key,
      name,
      mime,
      size,
      sha256,
      Date.now() + 15 * 60000,
      album.id,
    );
    res.json({ uploadId: id, ...grant });
  });
  app.post("/api/uploads/:id/cancel", async (req, res) => {
    const u = requireUser(req);
    const ticket = db
      .prepare("SELECT * FROM uploads WHERE id=? AND user_id=?")
      .get(String(req.params.id), u.id) as unknown as UploadRow;
    if (!ticket) throw new HttpError(404, "上传凭证不存在。");
    if (ticket.photo_id || completing.has(ticket.id))
      throw new HttpError(409, "照片已经完成或正在校验。");
    db.prepare("UPDATE uploads SET expires=0 WHERE id=? AND user_id=?").run(
      ticket.id,
      u.id,
    );
    if (storage) await storage.delete(ticket.object_key).catch(() => {});
    res.json({ ok: true });
  });
  app.post("/api/uploads/:id/complete", async (req, res) => {
    const u = requireUser(req);
    if (!storage) throw new HttpError(409, "当前为本地演示模式。");
    const ticket = db
      .prepare("SELECT * FROM uploads WHERE id=? AND user_id=?")
      .get(String(req.params.id), u.id) as unknown as UploadRow;
    if (!ticket) throw new HttpError(404, "上传凭证不存在或无权访问。");
    albumFor(ticket.album_id, u.id);
    if (ticket.photo_id) {
      const p = db
        .prepare("SELECT * FROM photos WHERE id=? AND user_id=?")
        .get(ticket.photo_id, u.id) as unknown as PhotoRow;
      return res.json(await dto(p));
    }
    if (ticket.expires < Date.now())
      throw new HttpError(410, "上传凭证已过期，请重新上传。");
    if (completing.has(ticket.id) || completing.size >= 2)
      throw new HttpError(429, "服务端正在处理照片，请稍候重试完成校验。");
    completing.add(ticket.id);
    const id = randomUUID(),
      prefix = `photos/${u.id}/${id}`,
      keys = [
        `${prefix}/original`,
        `${prefix}/view.jpg`,
        `${prefix}/thumb.jpg`,
      ];
    let committed = false;
    try {
      const info = await storage.head(ticket.object_key);
      if (
        info.size !== ticket.size ||
        info.size > config.maxBytes ||
        info.mime !== ticket.mime
      )
        throw new HttpError(422, "OSS 对象大小或类型与授权不符。");
      const bytes = await storage.get(ticket.object_key);
      if (bytes.length !== ticket.size)
        throw new HttpError(422, "对象大小校验失败。");
      const { createHash } = await import("node:crypto");
      if (createHash("sha256").update(bytes).digest("hex") !== ticket.sha256)
        throw new HttpError(422, "照片内容校验失败，请重新上传。");
      let view: Buffer, thumb: Buffer, width: number, height: number;
      try {
        const meta = await sharp(bytes, {
          limitInputPixels: 40000000,
          failOn: "error",
        }).metadata();
        if (
          !["jpeg", "png", "webp"].includes(meta.format || "") ||
          (meta.pages || 1) > 1
        )
          throw new Error("不支持动画或该文件格式");
        const output = await sharp(bytes, {
          limitInputPixels: 40000000,
          failOn: "error",
        })
          .rotate()
          .resize({
            width: 3200,
            height: 3200,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#111111" })
          .jpeg({ quality: 92 })
          .toBuffer({ resolveWithObject: true });
        view = output.data;
        width = output.info.width;
        height = output.info.height;
        thumb = await sharp(view)
          .resize({
            width: 800,
            height: 800,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        throw new HttpError(422, "图片解码失败、超过 4000 万像素或包含动画。");
      }
      // Copy validated bytes into a different, never browser-writable namespace.
      await storage.put(keys[0], bytes, ticket.mime);
      await storage.put(keys[1], view, "image/jpeg");
      await storage.put(keys[2], thumb, "image/jpeg");
      const createdAt = new Date().toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("INSERT INTO photos(id,user_id,name,object_key,display_key,thumb_key,width,height,size,created_at,album_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
          id,
          u.id,
          ticket.name,
          keys[0],
          keys[1],
          keys[2],
          width,
          height,
          ticket.size,
          createdAt,
          ticket.album_id,
        );
        db.prepare("UPDATE albums SET updated_at=? WHERE id=? AND user_id=?").run(createdAt,ticket.album_id,u.id);
        db.prepare(
          "UPDATE uploads SET photo_id=? WHERE id=? AND user_id=?",
        ).run(id, ticket.id, u.id);
        db.exec("COMMIT");
        committed = true;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      await storage.delete(ticket.object_key).catch(() => {});
      res
        .status(201)
        .json(
          await dto(
            db
              .prepare("SELECT * FROM photos WHERE id=?")
              .get(id) as unknown as PhotoRow,
          ),
        );
    } catch (e) {
      if (!committed)
        await Promise.allSettled(keys.map((k) => storage.delete(k)));
      throw e;
    } finally {
      completing.delete(ticket.id);
    }
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "接口不存在。")),
  );
  app.use(express.static(resolve("dist"), { maxAge: 0 }));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const e = err as { status?: number; code?: string };
      const status = e.status || 500;
      const message =
        err instanceof HttpError
          ? err.message
          : status === 413
            ? "请求数据过大。"
            : e.code === "NoSuchKey"
              ? "OSS 中尚未找到文件，请重试上传。"
              : "服务暂时不可用，请稍后重试。";
      if (status >= 500) console.error("Request failed:", e.code || "internal");
      res
        .status(status)
        .json({
          error: message,
          ...(e.code === "ACCOUNT_CHANGED" ? { code: e.code } : {}),
        });
    },
  );
  return { app, db };
}
