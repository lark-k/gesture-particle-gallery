import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Aperture,
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Cloud,
  Expand,
  Hand,
  ImagePlus,
  LoaderCircle,
  LogIn,
  LogOut,
  MousePointer2,
  MoveHorizontal,
  Plus,
  Pause,
  Play,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { Album, Photo, Quality } from "../../shared/types";
import { AlbumLibrary, type AlbumEntry, type LocalCover } from "./AlbumLibrary";
import { BookTransition } from "./BookTransition";
import { GalleryScene, type SceneSnapshot } from "../scene/GalleryScene";
import { HandCamera } from "../gesture/camera";
import { GestureRecognizer, type GestureDebug } from "../gesture/recognizer";
import { THEMES, savedTheme, type ThemeId } from "../scene/themes";
import { GESTURE, QUALITY } from "../config";
import {
  api,
  preparePhoto,
  uploadPhoto,
  setActiveAccount,
  type AppConfig,
  type PreparedPhoto,
} from "../upload/client";

const initial: SceneSnapshot = {
  environment: { theme: null, ready: false, hdrReady: false },
  state: "OVERVIEW",
  particles: "ASSEMBLED",
  selected: null,
  candidate: null,
  fps: 0,
  count: 0,
  loaded: 0,
  quality: "medium",
  textures: 0,
  geometries: 0,
  drawCalls: 0,
  wallAngle: 0,
  firstPhotoScreenX: 0,
  firstPhotoScreenY: 0,
  orbiting: false,
  homeError: 0,
};
const qualityLabel = { low: "流畅", medium: "均衡", high: "精细" };
const albumFromPath = () => location.pathname.match(/^\/albums\/([a-zA-Z0-9-]+)\/?$/)?.[1] || null;
export default function App() {
  const [albumId,setAlbumId] = useState<string|null>(albumFromPath);
  const [album,setAlbum] = useState<Album|null>(null);
  const [journey,setJourney] = useState<AlbumEntry|null>(null);
  const [galleryError,setGalleryError] = useState("");
  const [photosReady,setPhotosReady] = useState(false);
  const [galleryRetry,setGalleryRetry] = useState(0);
  const [totalPhotos,setTotalPhotos] = useState(0);
  const localPhotos = useRef(new Map<string,Photo[]>()), localCovers = useRef(new Map<string,LocalCover>());
  const host = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    cursor = useRef<HTMLDivElement>(null),
    gestureReturn = useRef<HTMLButtonElement>(null);
  const scene = useRef<GalleryScene | null>(null),
    camera = useRef<HandCamera | null>(null),
    recognizer = useRef(new GestureRecognizer());
  const [config, setConfig] = useState<AppConfig | null>(null),
    [configError, setConfigError] = useState(""),
    [snapshot, setSnapshot] = useState(initial),
    [photos, setPhotos] = useState<Photo[]>([]);
  const [quality, setQuality] = useState<Quality>(() =>
    (navigator.hardwareConcurrency || 4) <= 4 ? "low" : "medium",
  );
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [theme, setTheme] = useState<ThemeId>(savedTheme);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeRetry, setThemeRetry] = useState(0);
  const [themeError, setThemeError] = useState("");
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [help, setHelp] = useState(false),
    [debug, setDebug] = useState(false),
    [cameraOn, setCameraOn] = useState(false),
    [cameraStatus, setCameraStatus] = useState("摄像头未开启"),
    [gesture, setGesture] = useState<GestureDebug>(recognizer.current.debug);
  const [toast, setToast] = useState(""),
    [uploadOpen, setUploadOpen] = useState(false),
    [collectionOpen, setCollectionOpen] = useState(false),
    [authOpen, setAuthOpen] = useState(false),
    [tab, setTab] = useState<"login" | "register">("login"),
    [authBusy, setAuthBusy] = useState(false),
    [authError, setAuthError] = useState("");
  const [uploads, setUploads] = useState<
    {
      id: string;
      name: string;
      preview: string;
      progress: number;
      status: string;
      error: boolean;
    }[]
  >([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const interactionBlocked = useRef(false);
  interactionBlocked.current = help || authOpen || uploadOpen || collectionOpen || themeOpen || !!journey;
  const prepared = useRef(new Map<string, PreparedPhoto>()),
    localResources = useRef<PreparedPhoto[]>([]),
    abort = useRef<AbortController | null>(null),
    accountGeneration = useRef(0),
    mounted = useRef(true),
    userId = useRef<string | null>(null),
    uploadLock = useRef(false);
  const sessionChannel = useRef<BroadcastChannel | null>(null);
  const refreshSequence = useRef(0);
  const notify = (m: string) => setToast(m);
  const returnToAlbums = () => {
    abort.current?.abort(); camera.current?.stop(); setCameraOn(false);
    setAlbumId(null);setAlbum(null);setJourney(null);setGalleryError("");
    history.pushState({},"","/albums");
  };
  const enterAlbum = (entry:AlbumEntry) => {
    setGalleryError("");setPhotosReady(false);setSnapshot(initial);setAlbum(entry.album);
    setJourney(entry);setAlbumId(entry.album.id);
    history.pushState({},"",`/albums/${entry.album.id}`);
    window.scrollTo(0,0);
  };
  useEffect(()=>{
    const pop=()=>{setAlbumId(albumFromPath());setJourney(null);setAlbum(null);setGalleryError("");};
    window.addEventListener("popstate",pop);
    const mq=matchMedia("(prefers-reduced-motion: reduce)");
    const change=()=>setReduced(mq.matches);mq.addEventListener("change",change);
    return()=>{window.removeEventListener("popstate",pop);mq.removeEventListener("change",change);};
  },[]);
  const refresh = () => {
    const sequence = ++refreshSequence.current;
    return api<AppConfig>("/api/config")
      .then((c) => {
        if (sequence !== refreshSequence.current || !mounted.current) return;
        setActiveAccount(c.user?.id || null);
        setConfig(c);
        setConfigError("");
      })
      .catch((e) => {
        if (sequence === refreshSequence.current && mounted.current)
          setConfigError(e.message);
      });
  };
  useEffect(() => {
    mounted.current = true;
    const sync = () => {
      void refresh();
    };
    const visible = () => {
      if (!document.hidden) sync();
    };
    const storageSync = (e: StorageEvent) => {
      if (e.key === "stillspace:session") sync();
    };
    if (typeof BroadcastChannel !== "undefined") {
      sessionChannel.current = new BroadcastChannel("stillspace:session");
      sessionChannel.current.onmessage = sync;
    }
    window.addEventListener("focus", sync);
    window.addEventListener("stillspace:session-changed", sync);
    window.addEventListener("storage", storageSync);
    document.addEventListener("visibilitychange", visible);
    void refresh();
    return () => {
      mounted.current = false;
      refreshSequence.current++;
      sessionChannel.current?.close();
      sessionChannel.current = null;
      window.removeEventListener("focus", sync);
      window.removeEventListener("stillspace:session-changed", sync);
      window.removeEventListener("storage", storageSync);
      document.removeEventListener("visibilitychange", visible);
      accountGeneration.current++;
      abort.current?.abort();
      camera.current?.stop();
      prepared.current.forEach((p) => p.revoke());
      localResources.current.forEach((p) => p.revoke());
    };
  }, []);
  const announceSessionChange = () => {
    sessionChannel.current?.postMessage("changed");
    try {
      localStorage.setItem("stillspace:session", crypto.randomUUID());
    } catch {
      /* Storage-disabled browsers still use BroadcastChannel / focus refresh. */
    }
  };
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 7500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!host.current || (config?.user && !albumId)) return;
    setSnapshot(initial);
    setGalleryError("");
    let s: GalleryScene;
    try {
      s = new GalleryScene(host.current, quality, reduced);
    } catch {
      notify("无法初始化 WebGL 2，请启用浏览器硬件加速后重新加载。");
      setGalleryError("无法初始化画廊，请启用浏览器硬件加速后重试。");
      return;
    }
    scene.current = s;
    s.onChange = (v) => setSnapshot((old) => ({ ...v, fps: v.fps || old.fps }));
    s.onError = m => { notify(m); setGalleryError(m); };
    s.onReturn = () => recognizer.current.reset();
    return () => {
      s.dispose();
      if (scene.current === s) scene.current = null;
    };
    // Recreate the entire GPU resource scope on account switch.
  }, [config?.user?.id, albumId, galleryRetry]);
  useEffect(() => {
    let cancelled = false;
    const current = scene.current;
    if (!current) return;
    setThemeLoading(true);
    setThemeError("");
    current.setTheme(theme).then((complete) => {
      if (cancelled) return;
      if (!complete) setThemeError("部分环境素材未能加载，可重试补全；照片仍可操作。");
      try { localStorage.setItem("stillspace:theme", theme); } catch { /* Session choice still works. */ }
    }).catch((e: Error) => {
      if (!cancelled) setThemeError(e.message);
    }).finally(() => { if (!cancelled) setThemeLoading(false); });
    return () => { cancelled = true; };
  }, [theme, themeRetry, config?.user?.id, albumId, galleryRetry]);
  useEffect(() => {
    scene.current?.setQuality(quality);
  }, [quality]);
  useEffect(() => {
    scene.current?.setReduced(reduced);
  }, [reduced]);
  useEffect(() => {
    scene.current?.setOrbiting(autoOrbit);
  }, [autoOrbit, config?.user?.id, albumId, galleryRetry]);
  useEffect(() => {
    scene.current?.setGestureControl(cameraOn);
  }, [cameraOn, config?.user?.id, albumId, galleryRetry]);
  useEffect(() => {
    if (!config) return;
    ++accountGeneration.current;
    if (userId.current !== (config.user?.id || null)) {
      // Preserve a direct album URL on initial login; clear it on an account switch.
      if (userId.current) { setAlbumId(null); setAlbum(null); setJourney(null); history.replaceState({},"","/albums"); }
      localPhotos.current.clear();localCovers.current.clear();
    }
    userId.current = config.user?.id || null;
    abort.current?.abort();
    uploadLock.current = false;
    setUploadBusy(false);
    setUploads([]);
    prepared.current.forEach((p) => p.revoke());
    prepared.current.clear();
    localResources.current.forEach((p) => p.revoke());
    localResources.current = [];
    camera.current?.stop();
    setCameraOn(false);
    recognizer.current.reset();
    setPhotos([]);
    setUploadOpen(false);
    setCollectionOpen(false);
  }, [config?.user?.id, config?.mode]);
  useEffect(() => {
    if (!config || (config.user && !albumId)) return;
    const generation = ++accountGeneration.current;
    abort.current?.abort();uploadLock.current=false;setUploadBusy(false);setUploads([]);
    prepared.current.forEach(p=>p.revoke());prepared.current.clear();
    setUploadOpen(false);setCollectionOpen(false);setPhotos([]);setPhotosReady(false);
    camera.current?.stop();setCameraOn(false);recognizer.current.reset();
    const controller = new AbortController();
    void (async () => {
      let list: Photo[] = [];
      if (config.user) {
        const [a,summary] = await Promise.all([
          api<Album>(`/api/albums/${albumId}`,undefined,controller.signal),
          api<{totalPhotos:number}>("/api/albums",undefined,controller.signal),
        ]);
        if (controller.signal.aborted || generation!==accountGeneration.current) return;
        setAlbum(a);
        setTotalPhotos(config.mode==="local" ? [...localPhotos.current.values()].reduce((n,p)=>n+p.length,0) : summary.totalPhotos);
        if (config.mode === "oss")
          list = (
            await api<{ photos: Photo[] }>(
              `/api/albums/${albumId}/photos`,
              undefined,
              controller.signal,
            )
          ).photos;
        else list=localPhotos.current.get(albumId!)||[];
      } else {
        const sampleRes = await fetch("/samples/manifest.json", {
          signal: controller.signal,
        });
        if (!sampleRes.ok)
          throw new Error("示例照片未准备，请运行 npm run setup:assets。");
        list = (await sampleRes.json()) as Photo[];
      }
      if (generation !== accountGeneration.current) return;
      setPhotos(list);
      scene.current?.addPhotos(list);
      setPhotosReady(true);
    })().catch((e) => {
      if (e.name !== "AbortError" && generation===accountGeneration.current) { notify(e.message); setGalleryError(e.message); }
    });
    return () => { controller.abort(); abort.current?.abort(); accountGeneration.current++; };
  }, [config?.user?.id, config?.mode, albumId, galleryRetry]);
  useEffect(() => {
    if (!video.current) return;
    const c = new HandCamera(video.current);
    camera.current = c;
    let lastDebug = 0;
    c.onStatus = setCameraStatus;
    c.onError = (m) => {
      recognizer.current.reset();
      scene.current?.rotateGesture(0);
      scene.current?.target(null);
      notify(m);
      setCameraOn(false);
    };
    c.onFrame = (f) => {
      if (interactionBlocked.current) {
        recognizer.current.reset(f.time);
        scene.current?.rotateGesture(0);
        scene.current?.target(null);
        if (cursor.current) cursor.current.style.opacity = "0";
        return;
      }
      const s = scene.current;
      if (!s) return;
      const ctx = {
        state: s.machine.state,
        candidate: s.machine.candidate,
        hit: (x: number, y: number) =>
          s.targetAt(x * innerWidth, y * innerHeight),
        returnHit: (x: number, y: number) => {
          const button = gestureReturn.current;
          if (!button || button.disabled) return false;
          const rect = button.getBoundingClientRect();
          return x * innerWidth >= rect.left && x * innerWidth <= rect.right &&
            y * innerHeight >= rect.top && y * innerHeight <= rect.bottom;
        },
        target: (id: string | null) => {
          if (s.machine.candidate !== id) s.target(id);
        },
        pull: (id: string) => { s.pull(id); return s.machine.state === "PULLING"; },
        push: () => { s.push(); return s.machine.state === "PUSHING"; },
        rotate: (v: number) => s.rotateGesture(v),
      };
      if (f.landmarks.length) recognizer.current.process(f, ctx);
      else recognizer.current.lost(f.time, ctx);
      const d = recognizer.current.debug;
      if (cursor.current) {
        cursor.current.style.opacity = d.cursor ? "1" : "0";
        cursor.current.dataset.locked = d.target ? "true" : "false";
        if (d.cursor)
          cursor.current.style.transform = `translate(${d.cursor.x * innerWidth}px,${d.cursor.y * innerHeight}px)`;
      }
      if (f.time - lastDebug > 80) {
        setGesture({ ...d });
        lastDebug = f.time;
      }
    };
    return () => {
      c.stop();
      if (camera.current === c) camera.current = null;
    };
  }, [config?.user?.id, albumId]);
  const toggleCamera = () => {
    if (cameraOn) {
      camera.current?.stop();
      scene.current?.rotateGesture(0);
      recognizer.current.reset();
      scene.current?.target(null);
      setCameraOn(false);
    } else {
      setCameraOn(true);
      void camera.current?.start();
    }
  };
  const authenticate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthError("");
    setAuthBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/api/auth/${tab}`, Object.fromEntries(form));
      announceSessionChange();
      await refresh();
      setAuthOpen(false);
      notify(
        tab === "login" ? "已进入你的独立影像空间" : "账户已创建，欢迎进入拾光",
      );
    } catch (e) {
      setAuthError((e as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("/api/auth/logout", {});
      refreshSequence.current++;
      setActiveAccount(null);
      setConfig((c) => (c ? { ...c, user: null } : c));
      announceSessionChange();
      notify(config?.mode === "oss" ? "已退出，照片已保存在你的账户中" : "已退出，当前设备的本地照片已清除");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const openUpload = () => {
    if (!config) {
      notify("请先启动后端服务");
      return;
    }
    if (!config.user) {
      setAuthOpen(true);
      return;
    }
    if (!albumId) { notify("请先创建或选择相册集。"); return; }
    setUploadOpen(true);
  };
  const processPrepared = async (
    id: string,
    p: PreparedPhoto,
    signal: AbortSignal,
    generation: number,
  ) => {
    const update = (progress: number, status: string, error = false) => {
      if (generation === accountGeneration.current && mounted.current)
        setUploads((v) =>
          v.map((x) => (x.id === id ? { ...x, progress, status, error } : x)),
        );
    };
    try {
      let photo: Photo;
      if (config?.mode === "oss")
        photo = await uploadPhoto(p, (n, label) => update(n, label), signal);
      else {
        photo = {...p.local,albumId:p.albumId};
        update(100, "已加入本次会话 · 未上传云端");
      }
      if (signal.aborted || generation !== accountGeneration.current) return;
      setPhotos((v) => [...v, photo]);
      setTotalPhotos(v=>v+1);
      if(config?.mode==="local" && p.albumId) localPhotos.current.set(p.albumId,[...(localPhotos.current.get(p.albumId)||[]),photo]);
      scene.current?.addPhotos([photo], true);
      if (config?.mode === "oss" && p.local.fullUrl)
        URL.revokeObjectURL(p.local.fullUrl);
      // Keep only the preview / decoded scene URLs after success, not the source File.
      p.file = new File([], p.file.name, { type: p.file.type });
      localResources.current.push(p);
      prepared.current.delete(id);
    } catch (e) {
      if (!signal.aborted) update(0, (e as Error).message, true);
    }
  };
  const selectFiles = async (files: FileList | null) => {
    if (!files?.length || uploadLock.current || !config?.user || !albumId) return;
    if (files.length > 10) {
      notify("每批最多选择 10 张照片。");
      return;
    }
    const own = totalPhotos;
    if (own + files.length > config.maxPhotos) {
      notify(`每个账户最多 ${config.maxPhotos} 张照片。`);
      return;
    }
    uploadLock.current = true;
    setUploadBusy(true);
    abort.current = new AbortController();
    const controller = abort.current,
      generation = accountGeneration.current;
    try {
      for (const file of Array.from(files)) {
        if (
          controller.signal.aborted ||
          generation !== accountGeneration.current
        )
          break;
        const id = crypto.randomUUID();
        try {
          const p = await preparePhoto(file, config.maxBytes);
          p.albumId = albumId;
          if (
            controller.signal.aborted ||
            generation !== accountGeneration.current
          ) {
            p.revoke();
            break;
          }
          prepared.current.set(id, p);
          setUploads((v) => [
            ...v,
            {
              id,
              name: file.name,
              preview: p.preview,
              progress: 0,
              status: "准备照片",
              error: false,
            },
          ]);
          await processPrepared(id, p, controller.signal, generation);
        } catch (e) {
          notify(`${file.name}：${(e as Error).message}`);
        }
      }
    } finally {
      if (generation === accountGeneration.current) {
        uploadLock.current = false;
        setUploadBusy(false);
      }
    }
  };
  const retryUpload = async (id: string) => {
    const p = prepared.current.get(id);
    if (!p || uploadLock.current) return;
    uploadLock.current = true;
    setUploadBusy(true);
    abort.current = new AbortController();
    const generation = accountGeneration.current;
    await processPrepared(id, p, abort.current.signal, generation);
    if (generation === accountGeneration.current) {
      uploadLock.current = false;
      setUploadBusy(false);
    }
  };
  const focused = ["FOCUSED", "PULLING", "PUSHING"].includes(snapshot.state);
  const busy = snapshot.state === "PULLING" || snapshot.state === "PUSHING";
  const particleBusy = ["ASSEMBLING", "DISSOLVING"].includes(
    snapshot.particles,
  );
  if (config?.user && !albumId) return <AlbumLibrary key={config.user.id} config={config} enter={enterAlbum}
    logout={()=>void logout()} localPhotos={localPhotos.current} localCovers={localCovers.current} notice={toast}/>;
  return (
    <main className={`${focused ? "app is-focused" : "app"}${albumId && config?.user ? " has-album" : ""}`} data-theme={theme}>
      {albumId && config?.user && <><button className="album-back" onClick={returnToAlbums}><ArrowLeft size={16}/> 返回相册集</button><span className="gallery-album-title">{album?.name||"正在打开相册…"}</span></>}
      {galleryError && !journey && config?.user && <div className="gallery-load-error" role="alert"><p>{galleryError}</p><button onClick={()=>setGalleryRetry(v=>v+1)}>重试加载</button><button onClick={returnToAlbums}>返回相册集</button></div>}
      <div className="ambient" />
      <header className="topbar">
        <a className="brand" href="/" aria-label="拾光首页">
          <span className="brand-mark">
            <Aperture size={26} strokeWidth={1.25} />
          </span>
          <span>
            拾光 <small>STILLSPACE</small>
          </span>
        </a>
        <div className="top-center">
          <span className="live-dot" /> 私人影像空间{" "}
          <span className="nav-slash">/</span> 360° GALLERY
        </div>
        <nav>
          <button
            className="icon-button help-top"
            onClick={() => setHelp(true)}
            aria-label="使用帮助"
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="mobile-orbit icon-button"
            disabled={reduced || cameraOn}
            onClick={() => setAutoOrbit((v) => !v)}
            aria-label={autoOrbit ? "暂停自动漫游" : "开启自动漫游"}
          >
            {autoOrbit ? <Pause size={14} /> : <Play size={14} />}
          </button>
          {config?.user ? (
            <button
              className="account"
              onClick={() => void logout()}
              title="退出登录"
            >
              <span>{config.user.username}</span>
              <LogOut size={15} />
            </button>
          ) : (
            <button className="account" onClick={() => setAuthOpen(true)}>
              <LogIn size={15} /> 登录
            </button>
          )}
          <button className="primary upload-top" onClick={openUpload}>
            <Plus size={17} /> 添加照片
          </button>
        </nav>
      </header>
      <section className="intro" aria-hidden={focused}>
        <div className="eyebrow">
          <span /> {THEMES[theme].english}
        </div>
        <h1>{THEMES[theme].title}<span className="title-period">。</span></h1>
        <p>{THEMES[theme].subtitle}</p>
      </section>
      <div ref={host} className="scene" data-testid="scene" />
      {!focused && (
        <>
          <div className="theme-navigation">
            <button className="theme-trigger" onClick={() => setThemeOpen(true)} aria-label="选择空间主题" aria-haspopup="dialog">
              <img src={`/environments/${theme}-panorama.jpg`} alt="" />
              <span><small>空间主题</small>{THEMES[theme].name}</span><ChevronDown size={15}/>
            </button>
            <button className="orbit-toggle" disabled={reduced || cameraOn} onClick={() => setAutoOrbit(v => !v)} aria-label={autoOrbit ? "暂停自动漫游" : "开启自动漫游"}>
              {autoOrbit && !reduced ? <Pause size={13}/> : <Play size={13}/>}
              {cameraOn ? "手势控制 · 漫游暂停" : reduced ? "减少动态已开启" : !autoOrbit ? "漫游已暂停" : snapshot.orbiting ? "环绕漫游中" : "操作后继续漫游"}
            </button>
          </div>
          <button
            className="orbit-arrow left"
            aria-label="向左旋转"
            onClick={() => scene.current?.rotate(-0.65)}
          >
            <ChevronLeft />
          </button>
          <button
            className="orbit-arrow right"
            aria-label="向右旋转"
            onClick={() => scene.current?.rotate(0.65)}
          >
            <ChevronRight />
          </button>
          <div className="scene-hint">
            <span className="hint-dot" />
            {snapshot.candidate
              ? snapshot.candidate.source === "sample"
                ? `点击查看 · ${snapshot.candidate.name}`
                : "点击查看照片"
              : config?.user && snapshot.count === 0
                ? "添加第一张照片，开启你的影像空间"
                : "拖动探索空间 · 点击拉近照片"}
            <span className="hint-divider" />
            <button
              className="collection-count"
              onClick={() => setCollectionOpen(true)}
              title="打开照片目录"
            >
              {String(snapshot.count).padStart(2, "0")} 帧记忆
            </button>
          </div>
        </>
      )}
      {focused && (
        <div className="focus-meta">
          <span className="eyebrow">
            {busy ? "光影正在重构" : "A MOMENT, HELD STILL"}
          </span>
          {snapshot.selected?.source === "sample" && <h2>{snapshot.selected.name}</h2>}
          <p>
            {snapshot.selected?.width} × {snapshot.selected?.height}{" "}
            <span> / </span>
            {snapshot.selected?.source === "oss"
              ? "私有 OSS"
              : snapshot.selected?.source === "local"
                ? "本次会话"
                : "示例摄影"}
          </p>
        </div>
      )}
      <div className="bottom-controls">
        {focused ? (
          <div className="toolbar focus-toolbar">
            <button
              onClick={() => scene.current?.push()}
              disabled={busy || particleBusy}
            >
              <ArrowLeft size={18} /> 返回总览 <kbd>Esc</kbd>
            </button>
            <span className="toolbar-divider" />
            <button
              className="particle-button"
              onClick={() => scene.current?.toggleParticles()}
              disabled={busy || particleBusy}
            >
              <Sparkles size={18} />
              {snapshot.particles === "DISPERSED"
                ? "聚合照片"
                : particleBusy
                  ? "光影重构中…"
                  : "分解为粒子"}
            </button>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <button
                className={
                  cameraOn ? "camera-control active" : "camera-control"
                }
                onClick={toggleCamera}
              >
                {cameraOn ? <CameraOff size={18} /> : <Hand size={19} />}{" "}
                {cameraOn ? "关闭手势" : "开启手势控制"}
                <span className="control-dot" />
              </button>
              <span className="toolbar-divider" />
              <div className="mouse-mode">
                <MousePointer2 size={16} /> 拖动环游 · 点击查看
              </div>
              <span className="toolbar-divider" />
              <button
                className="icon-button"
                onClick={() => setHelp(true)}
                aria-label="操作指南"
              >
                <CircleHelp size={18} />
              </button>
            </div>
            <p className="privacy-note">
              {cameraOn
                ? "摄像头画面仅在此设备处理，不上传视频"
                : "开启摄像头，让你的手成为空间的光标"}
            </p>
          </>
        )}
      </div>
      {(themeLoading || themeError) && <div className="environment-status" role="status">
        {themeLoading ? <><LoaderCircle size={14} className="spin"/> 正在展开{THEMES[theme].name}…</> : <>{themeError}<button onClick={() => setThemeRetry(v => v + 1)}>重新加载</button></>}
      </div>}
      {themeOpen && <Modal title="选择一处，安放记忆" subtitle="NATURAL SPACES" close={() => setThemeOpen(false)}>
        <p className="theme-introduction">三种自然空间，环绕同一份影像收藏。</p>
        <div className="theme-options">
          {(Object.entries(THEMES) as [ThemeId, typeof THEMES[ThemeId]][]).map(([id, item], i) =>
            <button key={id} className={theme === id ? "theme-option selected" : "theme-option"} aria-pressed={theme === id} onClick={() => { setTheme(id); setThemeOpen(false); }}>
              <img src={`/environments/${id}-panorama.jpg`} alt={item.description}/>
              <span><small>0{i + 1}{id === "forest" ? " · 默认" : ""}</small><strong>{item.name}</strong><span>{item.description}</span></span>
              {theme === id && <Check size={18}/>}
            </button>)}
        </div>
        <p className="theme-introduction">选择保存在此浏览器。照片与账号权限保持独立。</p>
      </Modal>}
      <footer>
        <div>
          <button onClick={() => setDebug((v) => !v)} aria-label="切换调试面板">
            <Settings2 size={14} />
          </button>
          <label className="quality-select">
            <span>画质 · </span>
            <select
              aria-label="画质"
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
            >
              {Object.entries(qualityLabel).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
          <span className="version">01 — ∞</span>
        </div>
      </footer>
      {cameraOn && !interactionBlocked.current && (
        <>
          <aside className="gesture-guide" data-mode={gesture.mode} aria-label="摄像头手势指引">
            <strong>{gesture.gesture}</strong>
            {gesture.mode === "rotate" ? (
              <>
                <div className="gesture-joystick" aria-label="掌心相对中立点的偏移">
                  <span className="joystick-center" />
                  <i style={{ left: `${50 + gesture.deflection * 45}%` }} />
                </div>
                <small>左移保持 ← 回中停止 → 右移保持 · 伸食指选任意照片</small>
              </>
            ) : gesture.mode === "calibrating" ? (
              <><progress value={gesture.progress} max={1} /><small>当前位置将成为中立点，小幅偏移就能持续旋转</small></>
            ) : <small>张掌：旋转摇杆　·　单食指：全屏指向，停留 0.7 秒确认</small>}
          </aside>
          {snapshot.state === "FOCUSED" && (
            <button ref={gestureReturn} className="gesture-return" aria-label="手势停留返回照片墙"
              disabled={!["ASSEMBLED", "DISPERSED"].includes(snapshot.particles)}
              onClick={() => scene.current?.push()}>
              <ArrowLeft size={22} /><span>返回照片墙<small>食指指向这里，停留确认</small></span>
              <progress value={gesture.mode === "return" ? gesture.progress : 0} max={1} />
            </button>
          )}
        </>
      )}
      <aside
        className={cameraOn ? "camera-preview visible" : "camera-preview"}
        aria-label="摄像头镜像预览"
      >
        <video ref={video} muted playsInline />
        <div>
          <span className="live-dot" />
          {cameraStatus}
        </div>
        <p>
          {gesture.gesture}{" "}
          {gesture.rotationSpeed !== 0 ? `· ${Math.round(Math.abs(gesture.rotationSpeed) * 180 / Math.PI)}°/s ` : ""}
          {gesture.progress > 0 ? `${Math.round(gesture.progress * 100)}%` : ""}
        </p>
      </aside>
      <div
        ref={cursor}
        className={cameraOn ? "hand-cursor" : "hand-cursor hidden"}
      >
        <div>
          <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18"
            strokeDasharray="113.1" strokeDashoffset={113.1 * (1 - (gesture.mode === "select" || gesture.mode === "return" ? gesture.progress : 0))} /></svg>
          <span>{gesture.progress > 0 && (gesture.mode === "select" || gesture.mode === "return") ? `${Math.round(gesture.progress * 100)}%` : "指向"}</span>
        </div>
      </div>
      {debug && (
        <aside className="debug-panel">
          <div>
            <strong>交互诊断</strong>
            <button onClick={() => setDebug(false)} aria-label="关闭调试">
              <X size={15} />
            </button>
          </div>
          <pre>
            {JSON.stringify(
              {
                state: snapshot.state,
                environment: snapshot.environment,
                particles: snapshot.particles,
                hand: gesture.status,
                gesture: gesture.gesture,
                candidate: snapshot.candidate?.name || null,
                pose: gesture.pose,
                controlMode: gesture.mode,
                dwellTarget: gesture.target,
                neutral: gesture.neutral,
                palmScale: +gesture.scale.toFixed(3),
                rotationSpeed: +gesture.rotationSpeed.toFixed(2),
                progress: +gesture.progress.toFixed(2),
                fps: +snapshot.fps.toFixed(1),
                loaded: snapshot.loaded,
                textures: snapshot.textures,
                geometries: snapshot.geometries,
                drawCalls: snapshot.drawCalls,
                wallAngle: snapshot.wallAngle,
                firstPhotoScreenX: snapshot.firstPhotoScreenX,
                firstPhotoScreenY: snapshot.firstPhotoScreenY,
                orbiting: snapshot.orbiting,
                homeError: snapshot.homeError,
                particleBudget: QUALITY[quality].particles,
                thresholds: GESTURE,
              },
              null,
              2,
            )}
          </pre>
        </aside>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}
      {configError && (
        <div className="server-error" role="alert">
          无法连接服务：{configError}
          <button onClick={() => void refresh()}>重新连接</button>
        </div>
      )}
      {help && (
        <Modal
          title="用手，走进一张照片"
          subtitle="A LITTLE GUIDE TO STILLSPACE"
          close={() => setHelp(false)}
        >
          <div className="guide-grid">
            <Guide
              n="01"
              icon={<MoveHorizontal />}
              title="张掌，摇杆浏览"
              text="张掌停稳建立中立点，向左或向右偏移并保持即可持续旋转。偏移越大转得越快，回中停止，无需反复挥手。"
            />
            <Guide
              n="02"
              icon={<MousePointer2 />}
              title="食指，全屏选片"
              text="食指自然伸出，其他三指稍弯即可，不必握紧，拇指位置不限。照片墙立即停转，指向任意照片并停留 0.7 秒，进度环填满后打开；移开取消。"
            />
            <Guide
              n="03"
              icon={<Hand />}
              title="停留，返回"
              text="查看照片时，用食指光标停留在大号返回按钮上，填满进度环即可返回。也可点击按钮或按 Esc。"
            />
          </div>
          <div className="guide-note">
            <MousePointer2 size={19} />
            <p>
              <strong>不用摄像头，也可以完整体验</strong>
              <br />
              拖动旋转 · 点击照片查看 · 分解 / 聚合按钮探索粒子
            </p>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => setReduced(e.target.checked)}
            />{" "}
            减少动态效果
          </label>
          <p className="fine-print">
            建议正面光线、完整手掌入镜。镜像预览与光标方向一致。单目摄像头使用掌部尺度估算推拉，侧转手掌可能降低识别稳定性。
          </p>
          <button
            className="text-button"
            onClick={() => {
              scene.current?.retryTextures();
              notify("正在重试加载照片");
            }}
          >
            重新加载失败的照片 <ArrowRight size={14} />
          </button>
          <button className="primary full" onClick={() => setHelp(false)}>
            开始探索 <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {authOpen && (
        <Modal
          title={tab === "login" ? "回到你的影像空间" : "创建你的影像空间"}
          subtitle="YOUR OWN LITTLE UNIVERSE"
          close={() => setAuthOpen(false)}
        >
          <form onSubmit={(e) => void authenticate(e)} className="auth-form">
            <label>
              用户名
              <input
                name="username"
                required
                minLength={3}
                maxLength={32}
                autoComplete="username"
                placeholder="3–32 位字母、数字或中文"
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                required
                minLength={tab === "register" ? 12 : 1}
                maxLength={128}
                autoComplete={
                  tab === "login" ? "current-password" : "new-password"
                }
                placeholder={tab === "register" ? "至少 12 位" : "输入你的密码"}
              />
            </label>
            {tab === "register" && config?.registration === "invite" && (
              <label>
                邀请码
                <input name="inviteCode" required autoComplete="off" />
              </label>
            )}
            {authError && (
              <p className="form-error" role="alert">
                {authError}
              </p>
            )}
            <button className="primary full" disabled={authBusy}>
              {authBusy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <LogIn size={17} />
              )}{" "}
              {tab === "login" ? "登录" : "创建账户"}
            </button>
          </form>
          {config?.registration !== "closed" && (
            <button
              className="text-button"
              onClick={() => {
                setTab((t) => (t === "login" ? "register" : "login"));
                setAuthError("");
              }}
            >
              {tab === "login" ? "还没有账户？创建账户" : "已有账户？返回登录"}{" "}
              <ArrowRight size={14} />
            </button>
          )}
          <p className="fine-print">
            照片与上传授权按账户隔离。
            {config?.mode === "local"
              ? "当前为本地演示，账户会保存，本地照片仅在本次会话中保留。"
              : "私有照片通过短时读取授权加载。"}
          </p>
        </Modal>
      )}
      {collectionOpen && (
        <Modal
          title="每一帧，都在这里"
          subtitle="COLLECTION INDEX"
          close={() => setCollectionOpen(false)}
        >
          <p className="fine-print">
            {photos.length === 0
              ? "你的相册还是空的，添加第一张照片，留下属于你的记忆。"
              : "点击任意照片直接查看。较大的收藏会排入圆柱的其他层，均可从这里访问。"}
          </p>
          <div className="collection-grid">
            {photos.map((p, index) => (
              <button
                key={p.id}
                aria-label={p.source === "sample" ? p.name : `查看第 ${index + 1} 张照片`}
                onClick={() => {
                  setCollectionOpen(false);
                  void scene.current?.openPhoto(p.id);
                }}
              >
                <img src={p.thumbUrl} alt="" loading="lazy" />
                {p.source === "sample" && <span>{p.name}</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {uploadOpen && (
        <Modal
          title={`上传到「${album?.name || "当前相册集"}」`}
          subtitle={
            config?.mode === "oss"
              ? "UPLOAD TO YOUR PRIVATE COLLECTION"
              : "LOCAL DEMO · SESSION ONLY"
          }
          close={() => setUploadOpen(false)}
        >
          <label
            className={"dropzone" + (uploadBusy ? " disabled" : "")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void selectFiles(e.dataTransfer.files);
            }}
          >
            <ImagePlus size={30} />
            <strong>
              {uploadBusy ? "正在处理照片…" : "点击选择，或把照片拖到这里"}
            </strong>
            <span>
              JPG / PNG / WebP · 每张最多{" "}
              {Math.round((config?.maxBytes || 20971520) / 1024 / 1024)} MB ·
              每批 10 张
            </span>
            <input
              aria-label="选择照片"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploadBusy}
              onChange={(e) => {
                void selectFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="upload-list">
            {uploads.map((u) => (
              <div key={u.id} className="upload-row">
                <img src={u.preview} alt="" />
                <div>
                  <strong>{u.name}</strong>
                  <p className={u.error ? "form-error" : ""}>{u.status}</p>
                  {!u.error && u.progress < 100 && (
                    <progress max={100} value={u.progress} />
                  )}
                </div>
                {u.error ? (
                  <button
                    disabled={uploadBusy}
                    onClick={() => void retryUpload(u.id)}
                  >
                    重试
                  </button>
                ) : u.progress === 100 ? (
                  <Check size={18} />
                ) : (
                  <LoaderCircle size={18} className="spin" />
                )}
              </div>
            ))}
          </div>
          <div className="guide-note">
            <Cloud size={19} />
            <p>
              {config?.mode === "oss"
                ? "照片直接上传到私有 OSS，校验后保存。仅你登录后可读取。"
                : "本地演示模式：照片只在当前页面会话有效，刷新或退出即清除，不会上传到 OSS。"}
            </p>
          </div>
          <button className="primary full" onClick={() => setUploadOpen(false)}>
            返回影像空间 <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {journey && <BookTransition entry={journey} background={`/environments/${theme}-panorama.jpg`}
        ready={photosReady && snapshot.environment.ready && (photos.length===0 || snapshot.loaded>0) && !galleryError}
        error={galleryError || themeError} reduced={reduced} complete={()=>setJourney(null)} cancel={returnToAlbums}
        retry={()=>{setGalleryError("");setThemeError("");setGalleryRetry(v=>v+1);}}/>}
    </main>
  );
}
function Guide({
  n,
  icon,
  title,
  text,
}: {
  n: string;
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="guide">
      <span>{n}</span>
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Modal({
  title,
  subtitle,
  close,
  children,
}: {
  title: string;
  subtitle: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>("button,input")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select,a[href]",
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭窗口"
          onClick={close}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">{subtitle}</span>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
