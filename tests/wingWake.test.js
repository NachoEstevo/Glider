import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WingWake } from '../src/water/WingWake.js';
import { worldHeight } from '../src/world/worldHeight.js';

function fixture(height = 0.2) {
  const impacts = Array.from({ length: 8 }, () => new THREE.Vector4());
  const sizes = new Array(8).fill(1);
  const wake = new WingWake({ uniforms: { uImpact: { value: impacts }, uImpactSize: { value: sizes } } });
  const tips = [new THREE.Object3D(), new THREE.Object3D()];
  tips[0].position.set(10000, height, 10000);
  tips[1].position.set(10000, 10, 10000);
  const flight = { speed: 34, bank: 0.65, obstacleTop: () => -Infinity };
  return { wake, impacts, sizes, tips, flight };
}

test('grazing emits small bounded impulses at the wingtip with a cooldown', () => {
  const { wake, impacts, sizes, tips, flight } = fixture();
  wake.update(0.016, tips, flight);
  assert.equal(impacts.filter((e) => e.w > 0).length, 1);
  assert.equal(impacts[0].x, 10000);
  assert.equal(impacts[0].y, 10000);
  assert.ok(impacts[0].w >= 0.02 && impacts[0].w <= 0.04);
  assert.equal(sizes[0], 0.3);
  wake.update(0.016, tips, flight);
  assert.equal(impacts.filter((e) => e.w > 0).length, 1);
  for (let i = 0; i < 40; i++) wake.update(0.2, tips, flight);
  assert.ok(impacts.length === 8 && impacts.every((e) => Number.isFinite(e.z) && e.w <= 0.04));
});

test('impulses expire after contact ends and high wings do not emit', () => {
  const { wake, impacts, tips, flight } = fixture();
  wake.update(0.016, tips, flight);
  tips[0].position.y = 10;
  wake.update(1.6, tips, flight);
  assert.ok(impacts.every((e) => e.w === 0));
  wake.update(0.5, tips, flight);
  assert.ok(impacts.every((e) => e.w === 0));
});

test('foam leaves gaps, reuses finite geometry and expires away from the sea', () => {
  const { wake, tips, flight } = fixture();
  let x = -4000;
  while (worldHeight(x, -4000) >= -3) x += 50;
  tips[0].position.set(x, 0.1, -4000);
  tips[1].position.set(x + 20, 10, -4000);
  const positions = wake.positions;
  wake.update(0.02, tips, flight);
  assert.ok(wake.strengths.every(v => v === 0), 'the first point must not connect to the origin');
  for (let i = 0; i < 500; i++) {
    tips[0].position.z += 0.4;
    tips[1].position.z += 0.4;
    wake.update(0.02, tips, flight);
  }
  assert.ok(wake.strengths.some(v => v > 0));
  assert.ok(wake.strengths.slice(256).every(v => v === 0), 'the high wing must not spray');
  assert.equal(wake.positions, positions);
  assert.equal(wake.positions.length, 512 * 3);
  assert.ok(wake.positions.every(Number.isFinite));
  tips[0].position.y = 20;
  wake.update(2, tips, flight);
  assert.ok(wake.ages.every(v => v >= 1.15 - 1e-6));
});

test('both wings write opposing finite spread vectors only over open water', () => {
  const { wake, tips, flight } = fixture();
  tips[1].position.set(10004, 0.2, 10000);
  for (let i = 0; i < 20; i++) {
    tips[0].position.z += 0.5;
    tips[1].position.z += 0.5;
    wake.update(1 / 60, tips, flight);
  }
  assert.ok(wake.strengths.slice(0, 256).some(v => v > 0));
  assert.ok(wake.strengths.slice(256).some(v => v > 0));
  assert.ok(wake.spread.every(Number.isFinite));
  assert.ok(wake.spread.some(v => v > 0) && wake.spread.some(v => v < 0));
  assert.equal(wake.sprayGeo.index, null);
  assert.equal(wake.sprayGeo.attributes.position.count, 512);
  const blocked = fixture();
  blocked.flight.obstacleTop = () => 10;
  for (let i = 0; i < 20; i++) { blocked.tips[0].position.z += 0.5; blocked.wake.update(1 / 60, blocked.tips, blocked.flight); }
  assert.ok(blocked.wake.strengths.every(v => v === 0));
  assert.ok(blocked.impacts.every(v => v.w === 0));
});
