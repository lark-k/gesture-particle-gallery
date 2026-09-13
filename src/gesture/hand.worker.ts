import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
let detector: HandLandmarker | null = null;
globalThis.onmessage = async (event: MessageEvent) => {
  const m = event.data;
  try {
    if (m.type === "init") {
      const files = await FilesetResolver.forVisionTasks(
        m.base + "/mediapipe/wasm",
        true,
      );
      try {
        detector = await HandLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: m.base + "/mediapipe/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });
      } catch {
        detector = await HandLandmarker.createFromOptions(files, {
          baseOptions: {
            modelAssetPath: m.base + "/mediapipe/hand_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.7,
          minHandPresenceConfidence: 0.7,
          minTrackingConfidence: 0.7,
        });
      }
      globalThis.postMessage({ type: "ready" });
    } else if (m.type === "frame") {
      try {
        const result = detector!.detectForVideo(m.bitmap, m.time);
        globalThis.postMessage({
          type: "result",
          landmarks: result.landmarks[0] || [],
          worldLandmarks: result.worldLandmarks[0] || [],
          // Handedness scores classify left/right; they are not presence scores.
          time: m.time,
          aspect: m.aspect,
        });
      } finally {
        m.bitmap.close();
      }
    } else if (m.type === "close") {
      detector?.close();
      detector = null;
    }
  } catch (e) {
    globalThis.postMessage({
      type: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }
};
