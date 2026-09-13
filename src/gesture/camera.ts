import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame } from "./recognizer";
export class HandCamera {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private detector: HandLandmarker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private busy = false;
  private generation = 0;
  private lastVideoTime = -1;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private cancelInitialization: (() => void) | null = null;
  onFrame: (f: HandFrame) => void = () => {};
  onStatus: (s: string) => void = () => {};
  onError: (s: string) => void = () => {};
  constructor(readonly video: HTMLVideoElement) {}
  async start() {
    if (this.running) return;
    this.running = true;
    const gen = ++this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "摄像头需要 HTTPS 或 localhost，并使用支持 WebRTC 的浏览器。",
        );
      this.onStatus("请求摄像头权限");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (!this.running || gen !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      stream.getVideoTracks().forEach((track) =>
        track.addEventListener(
          "ended",
          () => {
            if (this.running && gen === this.generation) {
              this.stop();
              this.onError(
                "摄像头已断开，请重新连接后开启；鼠标操作仍然可用。",
              );
            }
          },
          { once: true },
        ),
      );
      this.video.srcObject = stream;
      await this.video.play();
      if (!this.running || gen !== this.generation) return;
      this.onStatus("加载本地手部模型");
      try {
        await this.initWorker(gen);
      } catch {
        if (gen !== this.generation) return;
        this.worker?.terminate();
        this.worker = null;
        const { FilesetResolver, HandLandmarker } =
          await import("@mediapipe/tasks-vision");
        const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        if (!this.running || gen !== this.generation) return;
        const detector = await HandLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: "/mediapipe/hand_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });
        if (!this.running || gen !== this.generation) {
          detector.close();
          return;
        }
        this.detector = detector;
        this.onStatus("兼容模式 · CPU 12 Hz");
      }
      if (!this.running || gen !== this.generation) return;
      this.onStatus(
        this.worker ? "手势已开启 · 本地识别" : "兼容模式 · CPU 12 Hz",
      );
      this.loop();
    } catch (e) {
      if (gen !== this.generation) return;
      const name = e instanceof Error ? e.name : "";
      const errors: Record<string, string> = {
        NotAllowedError:
          "摄像头授权被拒绝。请在浏览器地址栏中允许访问，或继续用鼠标操作。",
        NotFoundError: "未找到摄像头，可继续用鼠标或触摸操作。",
        NotReadableError:
          "摄像头被占用或无法读取，请关闭其他使用摄像头的应用。",
      };
      this.stop();
      this.onError(
        errors[name] ||
          `手势识别启动失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  private initWorker(gen: number) {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./hand.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("模型加载超时"));
      }, 20000);
      const cancel = () => {
        cleanup();
        reject(new DOMException("摄像头初始化已取消", "AbortError"));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        if (this.cancelInitialization === cancel)
          this.cancelInitialization = null;
      };
      this.cancelInitialization = cancel;
      worker.onerror = () => {
        if (gen !== this.generation || this.worker !== worker) return;
        cleanup();
        reject(new Error("Worker 不可用"));
        if (this.busy) {
          this.stop();
          this.onError("手势线程中断，请重新开启摄像头。");
        }
      };
      worker.onmessage = (e) => {
        if (gen !== this.generation || this.worker !== worker || !this.running)
          return;
        const m = e.data;
        if (m.type === "ready") {
          cleanup();
          resolve();
        } else if (m.type === "result") {
          if (this.watchdog) clearTimeout(this.watchdog);
          this.busy = false;
          if (this.running) this.onFrame(m);
        } else if (m.type === "error") {
          cleanup();
          reject(new Error(m.message));
          if (this.busy) {
            this.stop();
            this.onError("手势推理失败，请重开摄像头或使用鼠标。");
          }
        }
      };
      worker.postMessage({ type: "init", base: location.origin });
    });
  }
  private loop = async () => {
    if (!this.running) return;
    const gen = this.generation;
    if (
      !document.hidden &&
      !this.busy &&
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.busy = true;
      const time = performance.now(),
        aspect = this.video.videoWidth / this.video.videoHeight;
      try {
        if (this.worker) {
          const bitmap = await createImageBitmap(this.video);
          if (!this.running || gen !== this.generation) {
            bitmap.close();
            return;
          }
          this.worker.postMessage({ type: "frame", bitmap, time, aspect }, [
            bitmap,
          ]);
          this.watchdog = setTimeout(() => {
            this.stop();
            this.onError("手势推理无响应，请重新开启摄像头。");
          }, 6000);
        } else if (this.detector) {
          const result = this.detector.detectForVideo(this.video, time);
          this.onFrame({
            landmarks: result.landmarks[0] || [],
            worldLandmarks: result.worldLandmarks[0] || [],
            // Detection/presence thresholds are enforced by HandLandmarker.
            time,
            aspect,
          });
          this.busy = false;
        }
      } catch {
        if (gen !== this.generation) return;
        this.stop();
        this.onError("摄像头帧处理失败，鼠标操作仍然可用。");
        return;
      }
    }
    if (this.running && gen === this.generation)
      this.timer = setTimeout(this.loop, this.worker ? 50 : 84);
  };
  stop() {
    this.running = false;
    this.generation++;
    this.cancelInitialization?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.worker?.postMessage({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
    this.detector?.close();
    this.detector = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.busy = false;
    this.lastVideoTime = -1;
    this.onStatus("摄像头已关闭");
  }
}
