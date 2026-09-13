import test from "node:test";
import assert from "node:assert/strict";
import { InteractionMachine } from "../src/interaction/machine";
test("state machine guards conflicting inputs and clears selection on return", () => {
  const m = new InteractionMachine();
  m.target("a");
  assert.equal(m.state, "TARGETING");
  assert.ok(m.pull("a"));
  assert.equal(m.pull("b"), false);
  assert.equal(m.push(), false);
  m.target("b");
  assert.equal(m.selected, "a");
  m.arrived();
  assert.equal(m.state, "FOCUSED");
  assert.ok(m.toggleParticles());
  assert.equal(m.push(), false);
  assert.equal(m.toggleParticles(), false);
  m.particles = "DISPERSED";
  assert.ok(m.push());
  m.arrived();
  assert.equal(m.state, "OVERVIEW");
  assert.equal(m.selected, null);
  assert.equal(m.candidate, null);
  assert.equal(m.particles, "ASSEMBLED");
});
test("100 rapid pull-return cycles remain operable", () => {
  const m = new InteractionMachine();
  for (let i = 0; i < 100; i++) {
    assert.ok(m.pull("photo"));
    for (let j = 0; j < 8; j++) assert.equal(m.pull("other"), false);
    m.arrived();
    assert.ok(m.push());
    m.arrived();
  }
  assert.equal(m.state, "OVERVIEW");
  m.recover();
  assert.equal(m.selected, null);
});
