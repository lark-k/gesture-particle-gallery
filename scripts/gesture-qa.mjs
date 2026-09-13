import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
try {
  await page.goto(process.env.TEST_URL || "http://localhost:5188", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const moduleUrl = path => performance.getEntriesByType("resource").find(e => new URL(e.name).pathname === path)?.name || path;
    const { HandCamera } = await import(moduleUrl("/src/gesture/camera.ts"));
    const { GalleryScene } = await import(moduleUrl("/src/scene/GalleryScene.ts"));
    HandCamera.prototype.start = async function () { window.__camera = this; this.onStatus("模拟手部输入"); };
    const snapshot = GalleryScene.prototype.snapshot;
    GalleryScene.prototype.snapshot = function (...args) { window.__scene = this; return snapshot.apply(this,args); };
    window.__feed = async (pose, x = .5, y = .5, frames = 1) => {
      for (let i=0;i<frames;i++) {
        let p = Array.from({length:21},()=>({x:.5,y:.65,z:0}));
        p[0]={x:.5,y:.72,z:0};
        [[.44,.49],[.49,.47],[.54,.49],[.59,.52]].forEach(([fx,fy],f)=>{
          for(let j=0;j<4;j++)p[5+f*4+j]={x:fx,y:fy-j*.075,z:0};
        });
        if(pose==="point") {
          // Natural pointing: index slightly bent, remaining fingers only partly curled.
          [.92,.78,.8,.75].forEach((ratio,f)=>{
            const tip=8+f*4,angle=Math.acos((9*ratio*ratio-5)/4);
            p[tip]={x:p[tip-1].x+.075*Math.sin(angle),y:p[tip-1].y-.075*Math.cos(angle),z:0};
          });
          const dx=1-(x*.76+.12)-p[8].x,dy=y*.8+.1-p[8].y;
          p=p.map(v=>({...v,x:v.x+dx,y:v.y+dy}));
        } else p=p.map(v=>({...v,x:v.x+x-.5}));
        window.__camera.onFrame({landmarks:p,time:performance.now(),aspect:1});
        await new Promise(r=>setTimeout(r,50));
      }
    };
  });
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__scene))).toBe(true);
  await page.getByRole("button",{name:"开启手势控制"}).click();
  const motion = await page.evaluate(async()=>{
    const s=window.__scene, feed=window.__feed;
    await feed("open",.5,.5,18);
    const orbiting=s.snapshot().orbiting;
    await feed("open",.44,.5,10); const n0=s.snapshot().wallAngle;
    await feed("open",.44,.5,12); const near=s.snapshot().wallAngle-n0;
    await feed("open",.35,.5,10); const f0=s.snapshot().wallAngle;
    await feed("open",.35,.5,12); const far=s.snapshot().wallAngle-f0;
    await feed("open",.5,.5,18); const stop=s.snapshot().wallAngle;
    await feed("open",.5,.5,10); const stoppedDrift=Math.abs(s.snapshot().wallAngle-stop);
    await feed("open",.65,.5,10); const r0=s.snapshot().wallAngle;
    await feed("open",.65,.5,12); const reverse=s.snapshot().wallAngle-r0;
    await feed("point",.5,.95,1); const p0=s.snapshot().wallAngle;
    await feed("point",.5,.95,8); const pointDrift=Math.abs(s.snapshot().wallAngle-p0);
    return {near,far,reverse,stoppedDrift,pointDrift,orbiting};
  });
  // Wall yaw is inverted relative to the screen-space rotation input.
  if (!(motion.near<0 && motion.far<motion.near*2 && motion.reverse>0 && motion.stoppedDrift<.01 && motion.pointDrift<.01 && !motion.orbiting))
    throw new Error(JSON.stringify(motion));
  const target=await page.evaluate(()=>{
    for(const x of [.15,.85,.25,.75])for(const y of [.4,.5,.6,.7]) {
      const id=window.__scene.targetAt(x*innerWidth,y*innerHeight);
      if(id)return {x,y,id};
    }
    throw new Error("No off-center photo found");
  });
  await page.evaluate(async t=>{ await window.__feed("point",t.x,t.y,30); },target);
  await expect.poll(()=>page.evaluate(()=>window.__scene.snapshot().state)).toBe("FOCUSED");
  await expect(page.getByRole("button",{name:"手势停留返回照片墙"})).toBeEnabled();
  await mkdir("docs/screenshots",{recursive:true});
  await page.screenshot({path:"docs/screenshots/gesture-focus-desktop.png"});
  await page.evaluate(async()=>{
    await window.__feed("point",.5,.9,10);
    const b=document.querySelector(".gesture-return").getBoundingClientRect();
    await window.__feed("point",(b.left+b.width/2)/innerWidth,(b.top+b.height/2)/innerHeight,32);
  });
  await expect.poll(()=>page.evaluate(()=>window.__scene.snapshot().state)).toBe("OVERVIEW");
  await page.evaluate(async()=>{await window.__feed("open",.5,.5,18);});
  await page.screenshot({path:"docs/screenshots/gesture-joystick-desktop.png"});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"docs/screenshots/gesture-joystick-mobile.png"});
  if(errors.length)throw new Error(errors.join("\n"));
  const report={date:new Date().toISOString(),motion,offCenterSelection:target,returned:true,errors,
    scope:"Synthetic landmarks through actual App, recognizer and Edge WebGL scene. Physical camera accuracy is not measured."};
  await writeFile("docs/gesture-qa.json",JSON.stringify(report,null,2));
  console.log(report);
} finally { await browser.close(); }
