import { useEffect, useRef, useState } from "react";
import { BufferGeometry, Float32BufferAttribute, Mesh, OrthographicCamera, PlaneGeometry, Points, Scene, ShaderMaterial, SRGBColorSpace, Texture, Vector2, VideoTexture, WebGLRenderer } from "three";
import { stepMemorySpring } from "../interaction/memorySpring";
import { advanceMemoryMorph, memoryMorphEnvelope } from "../interaction/memoryMorph";
import { memoryBookBreath, memoryBookDeformation } from "../interaction/memoryBook";
import { MemoryVideoLoop, MemoryVideoState } from "../interaction/memoryVideo";

/** The photograph stays legible at both ends of a reversible particle transition. */
export default function MemoryCloud({ motion, paused, chapter }: { motion: boolean; paused: boolean; chapter: number }) {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef({ motion, paused, chapter });
  const wake = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  controls.current = { motion, paused, chapter };
  useEffect(() => { wake.current(); }, [motion, paused, chapter]);
  useEffect(() => {
    const element = host.current!;
    let disposed = false, frame = 0, inView = true, contextAvailable = true, firstRender = true;
    let renderer: WebGLRenderer | undefined, geometry: BufferGeometry | undefined;
    let photoGeometry: PlaneGeometry | undefined, photoMaterial: ShaderMaterial | undefined;
    let material: ShaderMaterial | undefined, texture: Texture | undefined;
    let videoTextures: VideoTexture[] = [], posterTexture: Texture | undefined;
    let resizeObserver: ResizeObserver | undefined, intersection: IntersectionObserver | undefined;
    const source = new Image();
    const poster = new Image();
    const videos = [document.createElement("video"), document.createElement("video")] as const;
    for (const video of videos) {
      video.muted = video.defaultMuted = true; video.playsInline = true; video.loop = false;
      video.preload = "auto"; video.src = "/home/family-memory.mp4";
    }
    const videoLoop = new MemoryVideoLoop(videos);
    const videoState = new MemoryVideoState();
    let videoRewinds = 0;
    let videoFailed = false, posterReady = false;
    const syncVideo = (wanted: boolean) => {
      videoLoop.setWanted(wanted && !videoFailed);
      if (!wanted) element.dataset.videoState = "paused";
    };
    for (const video of videos) video.onerror = () => { videoFailed = true; syncVideo(false); resume(); };
    const pointer = { x: -10000, y: -10000, active: false, touch: false, till: 0 };
    let scale = 1, width = 1, height = 1, imageWidth = 1200, imageHeight = 675, offsetX = 0;
    let resume = () => {};
    const leave = (event?: Event) => {
      // Touch browsers emit pointerleave on finger lift; keep the tapped memory playing.
      if (event?.type === "pointerleave" && (event as PointerEvent).pointerType === "touch") return;
      pointer.active = false; pointer.till = 0; syncVideo(false); resume();
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch" && event.type !== "pointerdown") return;
      const box = element.getBoundingClientRect();
      pointer.x = event.clientX - box.left - box.width / 2;
      pointer.y = box.height / 2 - (event.clientY - box.top);
      const u = (pointer.x - offsetX) / (imageWidth * scale) + .5;
      const v = .5 - pointer.y / (imageHeight * scale);
      pointer.active = u > .29 && u < .98 && v > .13 && v < .89;
      pointer.touch = event.pointerType === "touch";
      pointer.till = pointer.touch ? performance.now() + 8500 : 0;
      syncVideo(pointer.active && controls.current.motion && !controls.current.paused);
      resume();
    };
    const focus = () => { pointer.active = true; pointer.x = width * .2; pointer.y = 0; resume(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pointer.active = !pointer.active; resume(); }
    };
    const visibility = () => { if (document.hidden) { syncVideo(false); cancelAnimationFrame(frame); frame = 0; pointer.active = false; } else resume(); };
    const contextLost = (event: Event) => { event.preventDefault(); syncVideo(false); videoState.invalidateFrame(); contextAvailable = false; cancelAnimationFrame(frame); frame = 0; firstRender = true; setReady(false); };
    const contextRestored = () => { contextAvailable = true; resume(); };
    source.onload = () => {
      if (disposed) return;
      try {
        const mobile = element.clientWidth < 700;
        imageWidth = mobile ? 850 : 1200;
        imageHeight = Math.round(imageWidth * source.height / source.width);
        const sampler = document.createElement("canvas"); sampler.width = imageWidth; sampler.height = imageHeight;
        const ctx = sampler.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(source, 0, 0, imageWidth, imageHeight);
        const pixels = ctx.getImageData(0, 0, imageWidth, imageHeight).data;
        const positions: number[] = [], seeds: number[] = [], opacity: number[] = [];
        for (let y = 0; y < imageHeight; y += 3) for (let x = 0; x < imageWidth; x += 3) {
          const g = pixels[(y * imageWidth + x) * 4 + 1];
          const ink = Math.max(0, Math.min(1, (241 - g) / 90));
          const edge = Math.min(1, Math.max(0, (x / imageWidth - .25) * 18))
            * Math.min(1, y / imageHeight * 12, Math.max(0, (.90 - y / imageHeight) * 25), (1 - x / imageWidth) * 35);
          let hash = (x * 73856093 ^ y * 19349663) >>> 0;
          hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
          hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
          const seed = ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
          if (seed > ink * edge * .72 || ink * edge < .08) continue;
          positions.push(x - imageWidth / 2 + Math.sin(seed * 99) * 1.3, imageHeight / 2 - y, seed * 12);
          seeds.push(seed); opacity.push(ink * edge);
        }
        geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
        geometry.setAttribute("seed", new Float32BufferAttribute(seeds, 1));
        geometry.setAttribute("ink", new Float32BufferAttribute(opacity, 1));
        const origins = new Float32Array(positions), velocity = new Float32Array(positions.length);
        const shared = { time: { value: 0 }, morph: { value: 0 }, bridge: { value: 0 },
          pageBreath: { value: 0 }, pageSize: { value: new Vector2(imageWidth, imageHeight) } };
        material = new ShaderMaterial({
          transparent: true, depthWrite: false, depthTest: false,
          uniforms: { ...shared, size: { value: 8 } },
          vertexShader: `attribute float seed; attribute float ink;
            ${memoryBookDeformation}
            uniform float time; uniform float size; uniform float morph; uniform float bridge;
            varying float vAlpha; varying float vSeed;
            void main(){
              vec3 p=foldMemoryPage(position,position.xy/pageSize+.5);
              float phase=seed*6.283;
              p.xy+=vec2(cos(phase)*48.+sin(position.y*.018+time)*20.,sin(phase)*38.+cos(position.x*.012+time)*15.)*bridge;
              p.xy+=vec2(sin(time*.6+phase),cos(time*.5+phase))*morph*2.;
              gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
              gl_PointSize=size*(.7+seed*.65)*(1.+bridge*.22);
              vAlpha=ink*min(1.,bridge*1.25+morph*.20); vSeed=seed;
            }`,
          fragmentShader: `varying float vAlpha; varying float vSeed;
            void main(){
              float d=length(gl_PointCoord-.5);
              float core=exp(-d*d*290.);
              float halo=exp(-d*d*28.)*.28;
              float alpha=(core+halo)*(1.-smoothstep(.38,.5,d))*vAlpha;
              if(alpha<.003)discard;
              vec3 amber=mix(vec3(.43,.29,.09),vec3(.69,.49,.19),vSeed);
              gl_FragColor=vec4(mix(amber,vec3(1.,.92,.65),core),alpha);
            }`,
        });
        texture = new Texture(source); texture.colorSpace = SRGBColorSpace; texture.needsUpdate = true;
        videoTextures = videos.map(video => { const result = new VideoTexture(video); result.colorSpace = SRGBColorSpace; return result; });
        posterTexture = new Texture(poster); posterTexture.colorSpace = SRGBColorSpace;
        poster.onload = () => { if (!disposed) { posterTexture!.needsUpdate = true; posterReady = true; resume(); } };
        poster.src = "/home/family-memory-poster.jpg";
        photoGeometry = new PlaneGeometry(imageWidth, imageHeight, 100, 64);
        photoMaterial = new ShaderMaterial({
          transparent: true, depthWrite: false,
          uniforms: { ...shared, picture: { value: texture }, memory: { value: texture }, memoryNext: { value: texture }, loopBlend: { value: 0 }, videoFrame: { value: 0 } },
          vertexShader: `${memoryBookDeformation}
            varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(foldMemoryPage(position,uv),1.);}`,
          fragmentShader: `uniform sampler2D picture; uniform sampler2D memory; uniform sampler2D memoryNext; uniform float loopBlend; uniform float videoFrame; uniform float morph; uniform float bridge; varying vec2 vUv;
            float random(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
            void main(){
              vec3 color=texture2D(picture,vUv).rgb;
              vec4 target=texture2D(memory,vUv);
              if(videoFrame>.5) target=sRGBTransferEOTF(target);
              if(loopBlend>0.) target=mix(target,sRGBTransferEOTF(texture2D(memoryNext,vUv)),loopBlend);
              // Switch beneath the fully dissolved midpoint; never double-expose the two albums.
              vec3 transformed=mix(color,target.rgb,step(.5,morph));
              float grain=random(floor(vUv*vec2(550.,310.)));
              float intact=1.-smoothstep(grain*.34,grain*.34+.55,bridge);
              float edge=smoothstep(.15,.32,vUv.x)*smoothstep(0.,.07,1.-vUv.x)
                *smoothstep(0.,.12,vUv.y)*smoothstep(0.,.10,1.-vUv.y);
              gl_FragColor=vec4(transformed,edge*intact);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`,
        });
        renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
        renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
        renderer.domElement.setAttribute("aria-hidden", "true");
        renderer.domElement.addEventListener("webglcontextlost", contextLost);
        renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
        element.appendChild(renderer.domElement);
        const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 1000);
        camera.position.z = 100;
        const photograph = new Mesh(photoGeometry, photoMaterial), points = new Points(geometry, material);
        points.frustumCulled = false; photograph.renderOrder = 0; points.renderOrder = 1;
        scene.add(photograph, points);
        let last = performance.now(), elapsed = 0, progress = 0, settle = 0;
        const resize = () => {
          width = element.clientWidth; height = element.clientHeight;
          if (!width || !height || disposed) return;
          renderer!.setSize(width, height);
          camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2; camera.updateProjectionMatrix();
          // CSS owns the framing for both the loading image and the live scene.
          const imageBox = element.querySelector<HTMLImageElement>(".memory-fallback")!.getBoundingClientRect();
          const hostBox = element.getBoundingClientRect();
          scale = imageBox.width / imageWidth;
          offsetX = imageBox.left + imageBox.width / 2 - hostBox.left - width / 2;
          photograph.scale.setScalar(scale); points.scale.setScalar(scale);
          photograph.position.x = points.position.x = offsetX;
          material!.uniforms.size.value = Math.max(5, scale * 8) * renderer!.getPixelRatio();
          resume();
        };
        resize(); resizeObserver = new ResizeObserver(resize); resizeObserver.observe(element);
        const attr = geometry.getAttribute("position"), coords = attr.array as Float32Array;
        const lastVideoFrames = ["", ""];
        const tick = (now: number) => {
          if (disposed || document.hidden || !inView || !contextAvailable) { frame = 0; return; }
          const dt = Math.min(.035, (now - last) / 1000); last = now;
          const moving = controls.current.motion && !controls.current.paused;
          if (pointer.till && now > pointer.till) pointer.active = false;
          const active = pointer.active && moving;
          syncVideo(active);
          videoLoop.advance(now);
          const video = videos[videoLoop.index], videoTexture = videoTextures[videoLoop.index];
          // Some decoders miss rVFC notifications around a restart. Refresh at the source's 24 fps too.
          for (const index of new Set([videoLoop.index, videoLoop.nextIndex])) {
            const buffer = videos[index];
            const decodedFrame = `${videoLoop.cycles}:${Math.floor(buffer.currentTime * 24)}`;
            if (buffer.readyState >= 2 && !buffer.seeking && decodedFrame !== lastVideoFrames[index]) {
              videoTextures[index].needsUpdate = true; lastVideoFrames[index] = decodedFrame;
            }
          }
          const targetAvailable = !videoFailed && (videoState.hasFrame || video.readyState >= 2) || posterReady;
          progress = advanceMemoryMorph(progress, active && targetAvailable, dt, !controls.current.motion);
          const { hasFrame: hasVideoFrame, rewind } = videoState.update(video.readyState, videoFailed, active, progress === 0);
          photoMaterial!.uniforms.memory.value = hasVideoFrame ? videoTexture : posterReady ? posterTexture : texture;
          photoMaterial!.uniforms.videoFrame.value = hasVideoFrame ? 1 : 0;
          photoMaterial!.uniforms.memoryNext.value = videoTextures[videoLoop.nextIndex];
          photoMaterial!.uniforms.loopBlend.value = hasVideoFrame ? videoLoop.blend : 0;
          if (moving) elapsed += dt;
          if (rewind) { videoLoop.reset(); videoState.invalidateFrame(); lastVideoFrames.fill(""); videoRewinds++; }
          const { morph, bridge } = memoryMorphEnvelope(progress);
          shared.time.value = elapsed; shared.morph.value = morph; shared.bridge.value = bridge;
          shared.pageBreath.value = memoryBookBreath(elapsed, morph, controls.current.motion);
          const floating = controls.current.motion ? Math.sin(elapsed * .65) * (2 + 1.2 * (1 - morph)) : 0;
          photograph.position.y = points.position.y = floating;
          const disturbed = stepMemorySpring(coords, origins, velocity, dt,
            active ? { x: (pointer.x - offsetX) / scale, y: (pointer.y - floating) / scale, radius: (pointer.touch ? 60 : 100) / scale } : null, !controls.current.motion);
          attr.needsUpdate = true;
          element.dataset.effect = progress === 0 ? "photograph" : progress === 1 ? "family-memory" : active ? "dissolving" : "restoring";
          element.dataset.morph = progress.toFixed(3);
          element.dataset.pageBreath = shared.pageBreath.value.toFixed(3);
          if (++settle % 15 === 0) {
            element.dataset.displacement = disturbed.toFixed(2); element.dataset.particles = String(seeds.length);
            element.dataset.videoState = videoFailed ? "fallback" : !active ? "paused" : videoLoop.nextIndex !== videoLoop.index ? "loop-fade" : video.paused ? "paused" : "playing";
            element.dataset.videoBlend = videoLoop.blend.toFixed(3);
            element.dataset.videoTime = video.currentTime.toFixed(2);
            element.dataset.videoReady = String(video.readyState);
            element.dataset.videoSurface = hasVideoFrame ? "video" : "poster";
            element.dataset.videoRewinds = String(videoRewinds);
            element.dataset.videoCycle = String(videoLoop.cycles);
            element.dataset.videoBuffer = String(videoLoop.index);
            element.dataset.videoFrames = String(video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
            element.dataset.videoTextureVersion = String(videoTexture.version);
          }
          renderer!.render(scene, camera);
          if(firstRender){firstRender=false;setReady(true);}
          if (moving || progress > 0 && progress < 1 || disturbed > .025) frame = requestAnimationFrame(tick); else frame = 0;
        };
        resume = () => { if (!disposed && !frame && !document.hidden && inView && contextAvailable) { last = performance.now(); frame = requestAnimationFrame(tick); } };
        wake.current = resume;
        intersection = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; if (inView) resume(); else { syncVideo(false); cancelAnimationFrame(frame); frame = 0; pointer.active = false; } }, { threshold: .02 });
        intersection.observe(element); resume();
      } catch {
        syncVideo(false); videoTextures.forEach(texture => texture.dispose()); posterTexture?.dispose();
        renderer?.domElement.remove(); renderer?.dispose(); geometry?.dispose(); material?.dispose();
        photoGeometry?.dispose(); photoMaterial?.dispose(); texture?.dispose(); setReady(false);
      }
    };
    source.src = "/home/memory-album.png";
    element.addEventListener("pointermove", move); element.addEventListener("pointerdown", move);
    element.addEventListener("pointerleave", leave); element.addEventListener("pointercancel", leave);
    element.addEventListener("focus", focus); element.addEventListener("blur", leave); element.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true; wake.current = () => {}; cancelAnimationFrame(frame); source.onload = null; poster.onload = null;
      videoLoop.dispose(); videoTextures.forEach(texture => texture.dispose()); posterTexture?.dispose();
      for (const video of videos) { video.onerror = null; video.removeAttribute("src"); video.load(); }
      resizeObserver?.disconnect(); intersection?.disconnect();
      element.removeEventListener("pointermove", move); element.removeEventListener("pointerdown", move);
      element.removeEventListener("pointerleave", leave); element.removeEventListener("pointercancel", leave);
      element.removeEventListener("focus", focus); element.removeEventListener("blur", leave); element.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
      renderer?.domElement.removeEventListener("webglcontextlost", contextLost); renderer?.domElement.removeEventListener("webglcontextrestored", contextRestored);
      geometry?.dispose(); material?.dispose(); photoGeometry?.dispose(); photoMaterial?.dispose(); texture?.dispose();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, []);
  return <div ref={host} className="memory-cloud" data-ready={ready} tabIndex={0} role="img" aria-label="完整的回忆相册。悬停或轻触，经过流光粒子播放彩色家庭回忆；移开后聚拢还原。键盘按 Esc 还原。"><img className="memory-fallback" src="/home/memory-album.png" width={1672} height={941} alt=""/></div>;
}
