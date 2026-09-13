import test from "node:test";
import assert from "node:assert/strict";
import { GestureRecognizer, type GestureContext, type Landmark } from "../src/gesture/recognizer";
import { handGeometry } from "../src/gesture/geometry";
import { GESTURE as G } from "../src/config";

function hand(x = .5): Landmark[] {
  const p = Array.from({ length: 21 }, () => ({ x, y: .65, z: 0 }));
  p[0] = { x, y: .72, z: 0 };
  [[.44,.49],[.49,.47],[.54,.49],[.59,.52]].forEach(([fx,fy], f) => {
    for (let j = 0; j < 4; j++) p[5 + f * 4 + j] = { x: x + fx - .5, y: fy - j * .075, z: 0 };
  });
  return p;
}
function point(x = .5, y = .5) {
  const p = hand();
  for (const tip of [12,16,20]) p[tip] = { ...p[tip - 2] };
  const dx = 1 - (x * .76 + .12) - p[8].x, dy = y * .8 + .1 - p[8].y;
  return p.map(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
}
function bentHand(ratios: number[]) {
  const p = hand();
  ratios.forEach((ratio,f) => {
    const tip = 8 + f*4, length = .075;
    const angle = Math.acos((9*ratio*ratio-5)/4);
    p[tip] = {x:p[tip-1].x+length*Math.sin(angle), y:p[tip-1].y-length*Math.cos(angle),z:0};
  });
  return p;
}
function harness(state: GestureContext["state"] = "OVERVIEW") {
  const r = new GestureRecognizer(), actions: string[] = [], speeds: number[] = [];
  let time = 1000;
  const ctx: GestureContext = {
    state, candidate: null, hit: () => "photo", returnHit: (x,y) => x > .8 && y < .3,
    target: id => { ctx.candidate = id; },
    pull: id => { actions.push(id); ctx.state = "PULLING"; },
    push: () => { actions.push("return"); ctx.state = "PUSHING"; },
    rotate: v => { speeds.push(v); },
  };
  const feed = (p: Landmark[], frames = 1) => {
    for (let i = 0; i < frames; i++) { r.process({ landmarks: p, time, aspect: 1 }, ctx); time += 50; }
  };
  const lost = () => { r.lost(time, ctx); time += 50; };
  return { r, ctx, actions, speeds, feed, lost, now: () => time };
}

test("static poses ignore thumb and recognize forward-facing fingers using depth", () => {
  assert.equal(handGeometry(hand(), 1).pose, "open");
  const p = point(); p[4] = { ...p[8] };
  assert.equal(handGeometry(p, 1).pose, "point");
  const forward = hand().map(v => ({ x: v.x, y: .6, z: v.y - .6 }));
  assert.equal(handGeometry(forward, 1).pose, "open");
});
test("open palm must settle before it becomes a neutral joystick", () => {
  const h = harness(); h.feed(hand(.65), 10);
  assert.equal(h.r.debug.mode, "calibrating");
  assert.ok(h.speeds.every(v => v === 0));
  h.feed(hand(.65), 5);
  assert.equal(h.r.debug.mode, "rotate");
  assert.equal(h.r.debug.rotationSpeed, 0);
  assert.ok(h.r.debug.neutral!.x < .4);
  assert.equal(h.actions.length, 0);
});
test("moving palm cannot establish neutral until it settles", () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.feed(hand(.3 + i * .018));
  assert.equal(h.r.debug.mode, "calibrating");
  assert.ok(h.speeds.every(v => v === 0));
  h.feed(hand(.65), 20); assert.equal(h.r.debug.mode, "rotate");
});
test("held offset continuously rotates; larger offset is faster; return neutral stops", () => {
  const h = harness(); h.feed(hand(), 16);
  h.feed(hand(.44), 20); const near = h.r.debug.rotationSpeed;
  h.feed(hand(.35), 40); const far = h.r.debug.rotationSpeed;
  assert.ok(near > 0 && far > near * 2 && far <= G.rotationMaxSpeed);
  assert.ok(h.speeds.slice(-20).every(v => v > 3));
  h.feed(hand(), 20); assert.equal(h.r.debug.rotationSpeed, 0);
  assert.equal(h.actions.length, 0);
});
test("opposite offsets reverse direction and neutral deadzone suppresses tremor", () => {
  const h = harness(); h.feed(hand(), 16); h.feed(hand(.6), 20);
  assert.ok(h.r.debug.rotationSpeed < 0);
  h.feed(hand(.49), 20); assert.equal(h.r.debug.rotationSpeed, 0);
});
test("first pointing or unknown frame stops rotation before pose confirmation", () => {
  for (const p of [point(), point().map((v,i) => i === 8 ? { ...v, ...point()[6] } : v)]) {
    const h = harness(); h.feed(hand(),16); h.feed(hand(.35),20); h.feed(p);
    assert.equal(h.speeds.at(-1),0); assert.equal(h.r.debug.progress,0);
  }
});
test("pointing selects photos near either screen edge after dwell, once only", () => {
  for (const x of [.08,.92]) {
    const h = harness(); h.ctx.hit = (cx,cy) => Math.abs(cx-x)<.02 && Math.abs(cy-.6)<.02 ? "edge" : null;
    h.feed(point(x,.6),16); assert.equal(h.actions.length,0);
    h.feed(point(x,.6),8); assert.deepEqual(h.actions,["edge"]);
    h.feed(point(x,.6),30); assert.equal(h.actions.length,1);
  }
});
test("leaving a photo cancels dwell; reentering requires a fresh dwell", () => {
  const h = harness(); h.feed(point(),13); h.ctx.hit = () => null; h.feed(point(),2);
  assert.equal(h.r.debug.progress,0);
  h.ctx.hit = () => "photo"; h.feed(point(),10); assert.equal(h.actions.length,0);
  h.feed(point(),6); assert.deepEqual(h.actions,["photo"]);
});
test("changing target resets elapsed dwell", () => {
  const h = harness(); h.feed(point(),13); h.ctx.hit = () => "other";
  h.feed(point(),10); assert.equal(h.actions.length,0);
  h.feed(point(),6); assert.deepEqual(h.actions,["other"]);
});
test("moving across a large photo does not count as stable dwell", () => {
  const h = harness();
  for (let i = 0; i < 35; i++) h.feed(point(.1 + i * .02,.5));
  assert.equal(h.actions.length,0);
  h.feed(point(.78,.5),24); assert.deepEqual(h.actions,["photo"]);
});
test("unaccepted selection can retry instead of permanently latching", () => {
  const h = harness(); h.ctx.pull = () => false; h.feed(point(),24);
  assert.notEqual(h.r.debug.mode,"paused");
  h.ctx.pull = id => { h.actions.push(id); }; h.feed(point(),20);
  assert.deepEqual(h.actions,["photo"]);
});
test("return requires leaving button on focus entry, then a fresh stable hover", () => {
  const h = harness("FOCUSED"); h.feed(point(.9,.2),30);
  assert.equal(h.actions.length,0);
  h.feed(point(.5,.5),15); h.feed(point(.9,.2),28);
  assert.deepEqual(h.actions,["return"]);
});
test("focused mode cannot rotate or open background photos", () => {
  const h = harness("FOCUSED"); h.feed(hand(),20); h.feed(hand(.35),20); h.feed(point(),25);
  assert.ok(h.speeds.every(v => v === 0)); assert.equal(h.actions.length,0);
});
test("transition animations block all gesture actions", () => {
  for (const state of ["PULLING","PUSHING"] as const) {
    const h = harness(state); h.feed(hand(),20); h.feed(point(),25);
    assert.equal(h.actions.length,0); assert.ok(h.speeds.every(v => v === 0));
  }
});
test("tracking loss immediately stops and reacquires a new neutral without a jump", () => {
  const h = harness(); h.feed(hand(),16); h.feed(hand(.35),20); h.lost();
  assert.equal(h.speeds.at(-1),0); assert.equal(h.r.debug.neutral,null);
  h.feed(hand(.35),16); assert.equal(h.r.debug.rotationSpeed,0);
  assert.ok(h.r.debug.neutral!.x > .6);
});
test("tracking loss cancels partial dwell", () => {
  const h = harness(); h.feed(point(),13); h.lost(); h.feed(point(),13);
  assert.equal(h.actions.length,0); h.feed(point(),10); assert.deepEqual(h.actions,["photo"]);
});
test("a frame gap cannot finish dwell and repeated timestamps cannot advance it", () => {
  const h = harness(); h.feed(point(),13);
  h.r.process({landmarks:point(),time:h.now()+1000,aspect:1},h.ctx);
  assert.equal(h.r.debug.progress,0);
  for (let i=0;i<25;i++) h.r.process({landmarks:point(),time:h.now()+1000,aspect:1},h.ctx);
  assert.equal(h.actions.length,0);
});
test("invalid or tiny hands stop an active joystick", () => {
  for (const p of [[], hand().map(v => ({...v,x:NaN})), hand().map(v => ({x:v.x*.01,y:v.y*.01,z:0}))]) {
    const h = harness(); h.feed(hand(),16); h.feed(hand(.35),20); h.feed(p);
    assert.equal(h.speeds.at(-1),0); assert.equal(h.r.debug.mode,"waiting");
  }
});
test("flapping between hand poses cannot accumulate a selection", () => {
  const h = harness();
  for (let i=0;i<10;i++) { h.feed(point(),6); h.feed(hand(),2); }
  assert.equal(h.actions.length,0);
});
test("natural partly curled fingers and a slightly bent index still point", () => {
  for (const ratios of [[1,.78,.8,.75],[.88,.7,.72,.68],[1,.8,.78,.92]]) {
    const p = bentHand(ratios);
    assert.equal(handGeometry(p,1).pose,"point");
    const h = harness(); h.feed(p,24); assert.deepEqual(h.actions,["photo"]);
  }
});
test("V sign, fist and equally half-open fingers are not pointing", () => {
  for (const ratios of [[1,1,.4,.4],[.4,.4,.4,.4],[.8,.8,.8,.8]])
    assert.notEqual(handGeometry(bentHand(ratios),1).pose,"point");
});
test("pointing hysteresis tolerates small flex changes without changing mode", () => {
  const p = bentHand([.83,.74,.74,.74]);
  assert.equal(handGeometry(p,1).pose,"unknown");
  assert.equal(handGeometry(p,1,undefined,"point").pose,"point");
  assert.equal(handGeometry(hand(),1,undefined,"point").pose,"open");
});
test("short ambiguity pauses dwell; no confirmation happens during ambiguous frames", () => {
  const h = harness(); h.feed(point(),14); const progress=h.r.debug.progress;
  h.feed(bentHand([.84,.84,.84,.84]),2);
  assert.equal(h.actions.length,0); assert.equal(h.r.debug.progress,progress);
  h.feed(point(),1); assert.equal(h.actions.length,0);
  h.feed(point(),15); assert.deepEqual(h.actions,["photo"]);
});
test("persistent ambiguity clears dwell and cannot retain stale progress", () => {
  const h = harness(); h.feed(point(),14); h.feed(bentHand([.84,.84,.84,.84]),5);
  assert.equal(h.r.debug.progress,0); assert.equal(h.ctx.candidate,null);
  h.feed(point(),8); assert.equal(h.actions.length,0);
});
test("cursor rejects a one-frame spike but follows a deliberate move promptly", () => {
  const h = harness(); h.ctx.hit=()=>null; h.feed(point(.2,.5),12);
  h.feed(point(.9,.5)); assert.ok(h.r.debug.cursor!.x < .25);
  h.feed(point(.2,.5),3); assert.ok(h.r.debug.cursor!.x < .25);
  h.feed(point(.8,.5),4); assert.ok(h.r.debug.cursor!.x > .7);
});
