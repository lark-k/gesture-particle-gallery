import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveRoute } from "../src/ui/routes";
import { stepMemorySpring } from "../src/interaction/memorySpring";
import { advanceMemoryMorph, memoryMorphEnvelope } from "../src/interaction/memoryMorph";
import { memoryBookBreath } from "../src/interaction/memoryBook";

test("idle book opening starts at the original pose and settles away for video or reduced motion",()=>{
  assert.equal(memoryBookBreath(0,0,true),0);
  assert.ok(Math.abs(memoryBookBreath(7.5,0,true))<1e-12);
  assert.equal(memoryBookBreath(7.5/4,0,true),1);
  assert.equal(memoryBookBreath(7.5*3/4,0,true),-1);
  assert.equal(memoryBookBreath(7.5/4,1,true),0);
  assert.equal(memoryBookBreath(7.5/4,0,false),0);
  assert.equal(memoryBookBreath(7.5/4,.5,true),.25);
  assert.ok(Math.abs(memoryBookBreath(.016,0,true))<.015,"no sudden fold on the first frame");
});

test("hover morph preserves both full photographs and uses particles only between them",()=>{
  assert.deepEqual(memoryMorphEnvelope(0),{morph:0,bridge:0});
  assert.equal(memoryMorphEnvelope(.5).bridge,1);
  assert.equal(memoryMorphEnvelope(1).morph,1);
  assert.ok(memoryMorphEnvelope(1).bridge<1e-12);
  let progress=0;
  for(let i=0;i<100;i++) progress=advanceMemoryMorph(progress,true,1/60,false);
  assert.equal(progress,1);
  for(let i=0;i<100;i++) progress=advanceMemoryMorph(progress,false,1/60,false);
  assert.equal(progress,0);
});

test("rapid hover reversals retrace continuously and reduced motion preserves the original",()=>{
  let progress=0;
  for(let i=0;i<30;i++) progress=advanceMemoryMorph(progress,true,1/60,false);
  const before=progress;
  progress=advanceMemoryMorph(progress,false,1/60,false);
  assert.ok(progress<before && before-progress<.02);
  assert.ok(Math.abs(advanceMemoryMorph(progress,true,1/60,false)-before)<1e-12);
  assert.equal(advanceMemoryMorph(progress,true,10,true),0);
  assert.ok(advanceMemoryMorph(0,true,10,false)<.025,"tab stalls cannot skip the transition");
});

test("homepage, demo, library and private deep links remain separate",()=>{
  assert.deepEqual(resolveRoute("/"),{page:"home",albumId:null});
  assert.equal(resolveRoute("/albums/").page,"albums");
  assert.equal(resolveRoute("/demo").page,"demo");
  assert.deepEqual(resolveRoute("/albums/abc-123"),{page:"gallery",albumId:"abc-123"});
  for(const path of ["/unknown","/albums/id/extra","/albums/%2Fsecret","//external.test"])
    assert.equal(resolveRoute(path).page,"missing");
});
test("mouse flow displaces only nearby points and returns to the original memory",()=>{
  const original=new Float32Array([25,0,3,500,500,8]),p=original.slice(),v=new Float32Array(6);
  for(let i=0;i<60;i++) stepMemorySpring(p,original,v,1/60,{x:0,y:0,radius:118},false);
  assert.ok(p[0]>45,"near point moves outward");
  assert.ok(p[1]>0,"flow curves tangentially");
  assert.equal(p[3],500); assert.equal(p[4],500); assert.equal(p[2],3);
  for(let i=0;i<180;i++) stepMemorySpring(p,original,v,1/60,null,false);
  assert.ok(Math.abs(p[0]-25)<.05&&Math.abs(p[1])<.05,"returns without accumulating drift");
});
test("long frame gaps are bounded; reduced motion restores every point",()=>{
  const original=new Float32Array([20,10,2]),p=original.slice(),v=new Float32Array(3);
  for(let i=0;i<200;i++) stepMemorySpring(p,original,v,10,{x:0,y:0,radius:118},false);
  assert.ok([...p].every(Number.isFinite));assert.ok(Math.hypot(p[0]-20,p[1]-10)<118);
  assert.equal(stepMemorySpring(p,original,v,1/60,null,true),0);
  assert.deepEqual(p,original);assert.deepEqual(v,new Float32Array(3));
});
