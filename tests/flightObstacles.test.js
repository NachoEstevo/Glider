import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Flight } from '../src/glider/flight.js';
import { createFlightObstacleIndex, planRuins, ruinFrame } from '../src/world/ruins.js';

const building = (overrides = {}) => ({ x: 0, z: 0, y: -5, w: 10, d: 8, h: 30, yaw: 0.3, lean: 0.2, leanDir: 0.7, ...overrides });

test('flight bounds cover leaning buildings and setbacks in their parent frame', () => {
  const items = [building(), building({ y: 25, w: 5, d: 4, h: 12, onTop: true })];
  const topAt = createFlightObstacleIndex(items);
  for (let i = 0; i < items.length; i++) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion();
    ruinFrame(items, i, p, q);
    const corners = [];
    for (const x of [-items[i].w / 2, items[i].w / 2])
      for (const y of [0, items[i].h])
        for (const z of [-items[i].d / 2, items[i].d / 2])
          corners.push(new THREE.Vector3(x, y, z).applyQuaternion(q).add(p));
    const minX = Math.min(...corners.map(c => c.x)), maxX = Math.max(...corners.map(c => c.x));
    const minZ = Math.min(...corners.map(c => c.z)), maxZ = Math.max(...corners.map(c => c.z));
    const maxY = Math.max(...corners.map(c => c.y));
    assert.ok(topAt((minX + maxX) / 2, (minZ + maxZ) / 2) >= maxY - 1e-10);
    for (const c of corners) {
      // Sample just inside the bounds to avoid rounding differences at the exact edge.
      const x = c.x * 0.999999 + (minX + maxX) / 2 * 0.000001;
      const z = c.z * 0.999999 + (minZ + maxZ) / 2 * 0.000001;
      assert.ok(topAt(x, z) >= maxY - 1e-10);
    }
  }
  assert.equal(topAt(1000, 1000), -Infinity);
});

test('flight index skips submerged boxes and separates distant cells', () => {
  const topAt = createFlightObstacleIndex([building({ lean: 0, yaw: 0 }), building({ x: 300, y: -100, h: 5, lean: 0 })]);
  assert.equal(topAt(0, 0), 25);
  assert.equal(topAt(300, 0), -Infinity);
  assert.equal(topAt(100, 0), -Infinity);
});

test('shore roof lookup retains footprint filters while flight includes leaning ruins', () => {
  const plan = planRuins();
  const tower = plan.items.find(it => !it.onTop && Math.abs(it.lean) > 0.05 && it.y + it.h > 1);
  assert.ok(tower);
  assert.ok(Number.isFinite(plan.flightTopAt(tower.x, tower.z)));
  // A shoreline hit, if another building overlaps, still uses its original roof filters.
  const matches = plan.items.filter(it => {
    if (it.onTop || it.y + it.h < 0.4 || Math.abs(it.lean) > 0.05) return false;
    const c = Math.cos(it.yaw), s = Math.sin(it.yaw), dx = tower.x - it.x, dz = tower.z - it.z;
    return Math.abs(dx * c - dz * s) < it.w / 2 && Math.abs(dx * s + dz * c) < it.d / 2;
  });
  assert.equal(plan.topAt(tower.x, tower.z), Math.max(-Infinity, ...matches.map(it => it.y + it.h)));
});
test('flight swerves around a leaning building through its conservative index', () => {
  const top = createFlightObstacleIndex([building({ x: 0, z: 100, w: 20, d: 30, h: 90, yaw: .3, lean: .15 })]);
  const flight = new Flight({start: new THREE.Vector3(0, 25, -100), heading: 0, terrain: () => -10, obstacleTop: top});
  flight.autopilot = false;
  flight.input.steer = 1;
  flight.input.boost = true;
  for (let i = 0; i < 120; i++) {
    const y = flight.pos.y;
    flight.update(.1);
    assert.ok(Math.abs(flight.pos.y - y) < .5);
    for (let wing = -14; wing <= 14; wing++) {
      assert.equal(top(flight.pos.x + Math.cos(flight.heading) * wing, flight.pos.z - Math.sin(flight.heading) * wing), -Infinity);
    }
  }
  assert.ok(flight.pos.z > 130);
});
