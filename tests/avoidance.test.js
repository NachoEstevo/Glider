import test from 'node:test';
import assert from 'node:assert/strict';
import { ObstacleAvoidance } from '../src/glider/obstacleAvoidance.js';
import { Flight } from '../src/glider/flight.js';
import * as THREE from 'three';

const water = () => -10;
const pos = { x: 0, y: 25, z: 0 };
test('wingtip corridor detects a corner and keeps the selected side', () => {
  const avoidance = new ObstacleAvoidance(water, (x, z) => x >= 6 && x <= 16 && z >= 40 && z <= 70 ? 40 : -Infinity);
  const a = avoidance.sample(pos, 0, 34, .1);
  assert.ok(a.steer > 0);
  const b = avoidance.sample(pos, .05, 34, .1);
  assert.ok(b.steer > 0);
  assert.equal(a.water, false);
});
test('flying above a roof and empty water need no assist', () => {
  const roof = new ObstacleAvoidance(water, () => 10);
  assert.equal(roof.sample(pos, 0, 34, .1).steer, 0);
  const empty = new ObstacleAvoidance(water, () => -Infinity);
  const result = empty.sample(pos, 0, 34, .1);
  assert.equal(result.steer, 0);
  assert.equal(result.water, true);
});
test('tall roof triggers assist and emergency clearance', () => {
  const avoid = new ObstacleAvoidance(water, (x, z) => Math.abs(x) < 20 && z >= 10 && z <= 40 ? 100 : -Infinity);
  const result = avoid.sample(pos, 0, 34, .1);
  assert.notEqual(result.steer, 0);
  assert.equal(result.near, 100);
});
test('large flight steps remain finite and preserve roof clearance', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 20, 0), heading: 0, obstacleTop: (x, z) => Math.abs(x) < 30 && z > 10 && z < 100 ? 80 : -Infinity });
  flight.autopilot = false;
  flight.update(2);
  assert.ok(Number.isFinite(flight.pos.y));
  assert.ok(flight.pos.y >= 94);
});
test('neutral flight swerves around a building without climbing or wing contact', () => {
  const top = (x, z) => Math.abs(x) <= 10 && z >= 100 && z <= 140 ? 80 : -Infinity;
  const flight = new Flight({ start: new THREE.Vector3(0, 25, -100), heading: 0, terrain: water, obstacleTop: top });
  flight.autopilot = false;
  let maxHeight = flight.pos.y;
  let maxStep = 0;
  let previousY = flight.pos.y;
  for (let i = 0; i < 100; i++) {
    flight.update(.1);
    maxHeight = Math.max(maxHeight, flight.pos.y);
    maxStep = Math.max(maxStep, Math.abs(flight.pos.y - previousY));
    previousY = flight.pos.y;
    // Test the entire wing line, including corners as it turns.
    for (let x = -14; x <= 14; x += 1) {
      const wingX = flight.pos.x + Math.cos(flight.heading) * x;
      const wingZ = flight.pos.z - Math.sin(flight.heading) * x;
      assert.equal(top(wingX, wingZ), -Infinity);
    }
  }
  assert.ok(maxHeight < 26);
  assert.ok(maxStep < .5);
  assert.ok(Math.abs(flight.pos.x) > 30);
});
test('clear water permits a controlled descent to wing-grazing height', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 30, 0), heading: 0, terrain: water });
  flight.autopilot = false;
  flight.input.climb = -1;
  for (let i = 0; i < 300; i++) flight.update(.1);
  assert.ok(flight.pos.y >= 6.9 && flight.pos.y < 7.1);
  assert.equal(flight.avoidanceAssist, 0);
});
test('held descent levels out against the water floor so a banked wing can graze', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 30, 0), heading: 0, terrain: water });
  flight.autopilot = false;
  flight.input.climb = -1;
  flight.input.steer = 1;
  for (let i = 0; i < 300; i++) flight.update(.1);
  assert.ok(flight.pos.y >= 6.9 && flight.pos.y < 7.1);
  assert.ok(flight.vSpeed >= 0);
  assert.ok(Math.abs(flight.pitch) < .02);
  // Wingtip has 12.35 m lateral span and sits approximately 8 m behind the origin.
  const wingHeight = flight.pos.y - 12.35 * Math.sin(Math.abs(flight.bank)) + 8 * Math.sin(flight.pitch);
  assert.ok(Math.abs(wingHeight) < .8, `wingtip height ${wingHeight}`);
});
test('destination roof and terrain trigger the floor between corridor samples', () => {
  for (const kind of ['roof', 'terrain']) {
    const narrow = (x, z) => Math.abs(x) < 1 && z > 3 && z < 4;
    const flight = new Flight({
      start: new THREE.Vector3(0, 6.9, 0), heading: 0,
      terrain: (x, z) => kind === 'terrain' && narrow(x, z) ? 30 : -10,
      obstacleTop: (x, z) => kind === 'roof' && narrow(x, z) ? 30 : -Infinity,
    });
    flight.autopilot = false;
    flight.update(.1);
    assert.ok(flight.pos.z > 3 && flight.pos.z < 4);
    assert.ok(flight.pos.y >= 44, `${kind} destination was not cleared`);
  }
});
