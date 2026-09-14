import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryVideoLoop, MemoryVideoState } from "../src/interaction/memoryVideo";

test("loop seeks preserve the last video frame without showing the poster or rewinding", () => {
  const state = new MemoryVideoState();
  assert.equal(state.update(1, false, true, false).hasFrame, false);
  assert.equal(state.update(4, false, true, false).hasFrame, true);
  for (let loop = 0; loop < 5; loop++) {
    // Decode availability may briefly drop at the native loop boundary or during buffering.
    for (const ready of [4, 2, 1, 1, 2, 3, 4]) {
      assert.deepEqual(state.update(ready, false, true, false), {hasFrame: true, rewind: false});
    }
  }
});

test("rewind happens once after restoration, never during a quick hover reversal", () => {
  const state = new MemoryVideoState();
  state.update(4, false, true, true);
  assert.equal(state.update(4, false, false, false).rewind, false);
  assert.equal(state.update(4, false, true, false).rewind, false);
  assert.equal(state.update(4, false, false, true).rewind, true);
  // An asynchronous seek can leave currentTime nonzero for several render frames.
  for (let frame = 0; frame < 30; frame++) assert.equal(state.update(1, false, false, true).rewind, false);
  state.update(4, false, true, true);
  assert.equal(state.update(4, false, false, true).rewind, true);
});

test("actual media errors and lost GPU context still invalidate the retained frame", () => {
  const state = new MemoryVideoState();
  state.update(4, false, true, false);
  assert.equal(state.update(4, true, true, false).hasFrame, false);
  state.update(4, false, true, false);
  state.invalidateFrame();
  assert.equal(state.update(1, false, true, false).hasFrame, false);
  assert.equal(state.update(2, false, true, false).hasFrame, true);
});

class FakeVideo {
  readyState = 4;
  seeking = false;
  ended = false;
  paused = true;
  loads = 0;
  plays = 0;
  play() { this.paused = false; this.plays++; return Promise.resolve(); }
  pause() { this.paused = true; }
  load() { this.loads++; this.readyState = 1; this.ended = false; this.paused = true; }
}

test("ten alternating plays immediately blend for 650ms without a hold or resetting a visible frame", () => {
  const media = [new FakeVideo(), new FakeVideo()] as const;
  const loop = new MemoryVideoLoop(media);
  loop.setWanted(true);
  for (let cycle = 0; cycle < 10; cycle++) {
    const endedAt = cycle * 9000 + 6000;
    const current = loop.index, next = 1 - current;
    for (let frame = 0; frame < 145; frame++) loop.advance(endedAt - 6000 + frame * 1000 / 24);
    assert.equal(loop.index, current, "a partial play never advances the cycle");
    assert.equal(loop.cycles, cycle);
    media[next].readyState = 4;
    media[current].ended = true;
    media[current].paused = true;
    const plays = media[next].plays, loads = media[current].loads;
    loop.advance(endedAt);
    assert.equal(media[next].plays, plays + 1, "start the next play immediately, without a 1.5-second wait");
    loop.advance(endedAt + 16);
    assert.equal(loop.index, current);
    assert.equal(loop.nextIndex, next);
    assert.equal(loop.blend, 0, "incoming first frame must not hard-cut the outgoing frame");
    loop.advance(endedAt + 341);
    assert.equal(loop.blend, .5);
    assert.equal(media[current].loads, loads, "outgoing last frame survives the blend");
    loop.advance(endedAt + 665);
    assert.ok(loop.blend > .99 && loop.blend < 1);
    assert.equal(loop.index, current);
    loop.advance(endedAt + 666);
    assert.equal(loop.index, next);
    assert.equal(loop.nextIndex, next);
    assert.equal(loop.blend, 0);
    assert.equal(loop.cycles, cycle + 1);
    assert.equal(media[current].readyState, 1, "old decoder reloads behind the new visible video");
    assert.equal(media[next].paused, false);
  }
});

test("an unready next buffer cannot replace the last complete frame; pause and reset stop both", () => {
  const media = [new FakeVideo(), new FakeVideo()] as const;
  const loop = new MemoryVideoLoop(media);
  loop.setWanted(true);
  media[0].ended = true; media[1].readyState = 1;
  loop.advance(0); loop.advance(1500); loop.advance(1516);
  assert.equal(loop.index, 0);
  media[1].readyState = 4; media[1].seeking = true;
  loop.advance(1600); assert.equal(loop.index, 0);
  assert.equal(loop.blend, 0);
  loop.setWanted(false);
  assert.ok(media.every(video => video.paused));
  media[1].seeking = false;
  loop.advance(2000); assert.equal(loop.index, 0);
  loop.setWanted(true); loop.advance(3000);
  assert.equal(loop.index, 0);
  loop.advance(3650); assert.equal(loop.index, 1);
  loop.reset();
  assert.equal(loop.index, 0);
  assert.ok(media.every(video => video.paused));
  loop.dispose(); loop.setWanted(true);
  assert.ok(media.every(video => video.paused));
});

test("hover reversal pauses and resumes the blend without a time jump or resetting either visible frame", () => {
  const media = [new FakeVideo(), new FakeVideo()] as const;
  const loop = new MemoryVideoLoop(media);
  loop.setWanted(true);
  media[0].ended = true; media[0].paused = true;
  loop.advance(0); loop.advance(16); loop.advance(341);
  assert.equal(loop.blend, .5);
  loop.setWanted(false); loop.advance(10000);
  assert.equal(loop.blend, .5);
  assert.ok(media.every(video => video.paused));
  assert.ok(media.every(video => video.loads === 0));
  loop.setWanted(true); loop.advance(10000);
  assert.equal(loop.blend, .5, "paused time must not advance the fade");
  loop.advance(10325);
  assert.equal(loop.index, 1);
  assert.equal(media[0].loads, 1);
  loop.reset();
  assert.equal(loop.blend, 0);
  assert.equal(loop.nextIndex, 0);
});

test("reset and disposal cancel an unfinished transition without a delayed replay", () => {
  const media = [new FakeVideo(), new FakeVideo()] as const;
  const loop = new MemoryVideoLoop(media);
  loop.setWanted(true);
  media[0].ended = true; media[0].paused = true;
  loop.advance(0); loop.advance(16); loop.advance(200);
  loop.reset(); loop.advance(20000);
  assert.equal(loop.blend, 0);
  assert.equal(loop.nextIndex, 0);
  assert.equal(media[1].plays, 1);
  assert.ok(media.every(video => video.paused));

  media[0].readyState = 4;
  loop.setWanted(true);
  media[0].ended = true; media[0].paused = true;
  loop.advance(20000);
  loop.dispose(); loop.advance(30000);
  loop.setWanted(true); loop.advance(40000);
  assert.equal(media[1].plays, 2);
  assert.ok(media.every(video => video.paused));
});
