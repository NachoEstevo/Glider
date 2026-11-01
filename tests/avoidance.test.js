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
test('large flight steps remain finite without a roof-induced altitude jump', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 20, 0), heading: 0, obstacleTop: (x, z) => Math.abs(x) < 30 && z > 10 && z < 100 ? 80 : -Infinity });
  flight.autopilot = false;
  flight.update(2);
  assert.ok(Number.isFinite(flight.pos.y));
  assert.ok(flight.pos.y < 30);
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
test('terrain at destination triggers the floor between corridor samples', () => {
  const narrow = (x, z) => Math.abs(x) < 1 && z > 3 && z < 4;
  const flight = new Flight({ start: new THREE.Vector3(0, 6.9, 0), heading: 0,
    terrain: (x, z) => narrow(x, z) ? 30 : -10 });
  flight.autopilot = false;
  flight.update(.1);
  assert.ok(flight.pos.z > 3 && flight.pos.z < 4);
  assert.ok(flight.pos.y >= 44);
});

test('boost and opposing steering avoid the building without an altitude jump', () => {
  const top = (x, z) => Math.abs(x) <= 10 && z >= 100 && z <= 140 ? 80 : -Infinity;
  const flight = new Flight({ start: new THREE.Vector3(0, 25, -100), heading: 0, terrain: water, obstacleTop: top });
  flight.autopilot = false;
  flight.input.steer = 1;
  flight.input.boost = true;
  let previousY = flight.pos.y;
  for (let i = 0; i < 100; i++) {
    flight.update(.1);
    assert.ok(Math.abs(flight.pos.y - previousY) < .5);
    previousY = flight.pos.y;
    for (let lateral = -14; lateral <= 14; lateral++) {
      const x = flight.pos.x + Math.cos(flight.heading) * lateral;
      const z = flight.pos.z - Math.sin(flight.heading) * lateral;
      assert.equal(top(x, z), -Infinity);
    }
  }
  assert.ok(flight.pos.z > 140);
  assert.ok(flight.pos.y < 26);
});

test('late approach does not teleport vertically or cross a roof', () => {
  const top = (x, z) => Math.abs(x) < 20 && z >= 20 && z <= 60 ? 80 : -Infinity;
  const flight = new Flight({start: new THREE.Vector3(0, 25, 0), heading: 0, terrain: water, obstacleTop: top});
  flight.autopilot = false;
  flight.input.boost = true;
  for (let i = 0; i < 100; i++) {
    const before = flight.pos.y;
    flight.update(.1);
    assert.ok(Math.abs(flight.pos.y - before) < .5);
    for (let lateral = -14; lateral <= 14; lateral++) {
      const x = flight.pos.x + Math.cos(flight.heading) * lateral;
      const z = flight.pos.z - Math.sin(flight.heading) * lateral;
      assert.equal(top(x,z), -Infinity);
    }
  }
  assert.ok(flight.pos.z > 60, 'late approach must recover instead of remaining trapped');
});
test('100 m boost approach keeps moving smoothly while clearing nose, tail and wings', () => {
  const top = (x, z) => Math.abs(x) <= 10 && z >= 100 && z <= 140 ? 80 : -Infinity;
  const f = new Flight({start: new THREE.Vector3(0, 25, 0), heading: 0, terrain: water, obstacleTop: top});
  f.autopilot = false;
  f.input.steer = 1;
  f.input.boost = true;
  let previousSpeed = null;
  for (let i = 0; i < 100; i++) {
    const previous = f.pos.clone();
    f.update(.1);
    const speed = f.pos.distanceTo(previous) / .1;
    assert.ok(speed > 18, `motion slowed to ${speed}`);
    if (previousSpeed !== null) assert.ok(Math.abs(speed - previousSpeed) < 4);
    previousSpeed = speed;
    for (let longitudinal = -9; longitudinal <= 9; longitudinal++) {
      for (const lateral of [-3, 0, 3]) {
        const x = f.pos.x + Math.sin(f.heading) * longitudinal + Math.cos(f.heading) * lateral;
        const z = f.pos.z + Math.cos(f.heading) * longitudinal - Math.sin(f.heading) * lateral;
        assert.equal(top(x, z), -Infinity);
      }
    }
    for (let lateral = -14; lateral <= 14; lateral++) {
      assert.equal(top(f.pos.x + Math.cos(f.heading) * lateral, f.pos.z - Math.sin(f.heading) * lateral), -Infinity);
    }
  }
  assert.ok(f.pos.z > 140);
});
test('descending over a wide roof holds clearance without lifting or freezing flight', () => {
  const top = (x, z) => Math.abs(x) < 80 && z >= -80 && z <= 120 ? 40 : -Infinity;
  const flight = new Flight({ start: new THREE.Vector3(0, 54.1, 0), heading: 0, terrain: water, obstacleTop: top });
  flight.autopilot = false;
  flight.input.climb = -1;
  let leftRoof = false;
  for (let i = 0; i < 100; i++) {
    const beforeY = flight.pos.y, beforeZ = flight.pos.z;
    flight.update(.1);
    assert.ok(flight.pos.z > beforeZ, 'forward motion must continue');
    assert.ok(flight.pos.y <= beforeY + 1e-9, 'roof must not raise aircraft');
    if (flight.pos.z <= 129) assert.ok(flight.pos.y >= 54, 'full footprint must clear roof');
    else leftRoof = true;
  }
  assert.ok(leftRoof);
  assert.ok(flight.pos.y < 54, 'descent resumes after the roof');
});
