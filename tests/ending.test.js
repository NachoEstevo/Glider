import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession, FlightEnding } from '../src/story/ending.js';
import { Flight } from '../src/glider/flight.js';
import * as THREE from 'three';

test('audio clock reaches the end once and respects stalls', () => {
  const s = new FlightSession(10);
  assert.equal(s.update(4, { audioStarted: true, audioTime: 4 }).fuelFraction, 0.6);
  assert.equal(s.update(5, { audioStarted: true, audioTime: 4 }).time, 4);
  assert.equal(s.update(1, { audioStarted: true, audioTime: 10 }).shouldEnd, true);
  assert.equal(s.update(1, { audioStarted: true, audioTime: 10, audioEnded: true }).shouldEnd, false);
});

test('fallback advances, late audio cannot rewind, metadata cannot refill', () => {
  const s = new FlightSession(10);
  assert.equal(s.update(5).fuelFraction, 0.5);
  const state = s.update(1, { audioStarted: true, audioTime: 2, audioDuration: 20 });
  assert.equal(state.time, 5);
  assert.equal(state.fuelFraction, 0.5);
  const ended = s.update(0, { audioStarted: true, audioEnded: true });
  assert.equal(ended.shouldEnd, true);
  assert.equal(ended.fuelFraction, 0);
});

test('final glide clears terrain and produces a finite ending pose', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 70, 0), heading: .4, terrain: () => 50 });
  const rig = { zoom: 1 };
  const ending = new FlightEnding();
  ending.begin(flight, rig);
  for (let i = 0; i < 180; i++) {
    ending.update(.1, flight, rig);
    assert.ok(flight.pos.y >= 64);
  }
  assert.ok(ending.finished);
  assert.equal(ending.fade, 1);
  assert.equal(flight.throttle, 0);
  for (const value of Object.values(flight.pos)) assert.ok(Number.isFinite(value));
});

test('final glide preserves low water altitude without an upward jump', () => {
  const flight = new Flight({ start: new THREE.Vector3(0, 6.9, 0), heading: 0, terrain: () => -20 });
  const rig = { zoom: 1 };
  const ending = new FlightEnding();
  ending.begin(flight, rig);
  for (let i = 0; i < 180; i++) {
    ending.update(.1, flight, rig);
    assert.equal(flight.pos.y, 6.9);
  }
  assert.ok(ending.finished);
});
test('final glide avoids buildings without teleporting and ignores pilot input', () => {
  const top = (x, z) => Math.abs(x) < 10 && z >= 100 && z <= 140 ? 80 : -Infinity;
  const flight = new Flight({ start: new THREE.Vector3(0, 25, 0), heading: 0, terrain: () => -20, obstacleTop: top });
  flight.input = { steer: 1, climb: 1, boost: true };
  flight.idle = 20;
  flight.waypoint.set(1000, 0);
  const rig = { zoom: 1 }, ending = new FlightEnding();
  ending.begin(flight, rig);
  for (let i = 0; i < 180; i++) {
    const y = flight.pos.y;
    ending.update(.1, flight, rig);
    assert.ok(flight.pos.y - y < .1);
    assert.equal(flight.throttle, 0);
    for (let lateral = -14; lateral <= 14; lateral++) {
      assert.equal(top(flight.pos.x + Math.cos(flight.heading) * lateral, flight.pos.z - Math.sin(flight.heading) * lateral), -Infinity);
    }
    for (let longitudinal = -9; longitudinal <= 9; longitudinal++) {
      for (const lateral of [-3, 0, 3]) {
        const x = flight.pos.x + Math.sin(flight.heading) * longitudinal + Math.cos(flight.heading) * lateral;
        const z = flight.pos.z + Math.cos(flight.heading) * longitudinal - Math.sin(flight.heading) * lateral;
        assert.equal(top(x,z), -Infinity);
      }
    }
  }
  assert.ok(ending.finished);
  assert.ok(flight.pos.z > 140);
  assert.ok(flight.pos.y < 25);
});
test('final glide disregards controls and an active autopilot waypoint', () => {
  const create = () => new Flight({start: new THREE.Vector3(0, 60, 0), heading: 0, terrain: () => -20});
  const a = create(), b = create();
  a.input = {steer: 1, climb: 1, boost: true};
  a.idle = b.idle = 30;
  a.waypoint.set(2000, 0);
  b.waypoint.set(-2000, 0);
  const endA = new FlightEnding(), endB = new FlightEnding(), rigA = {zoom: 1}, rigB = {zoom: 1};
  endA.begin(a, rigA); endB.begin(b, rigB);
  for (let i = 0; i < 180; i++) { endA.update(.1, a, rigA); endB.update(.1, b, rigB); }
  assert.ok(a.pos.distanceTo(b.pos) < 1e-9);
  assert.equal(a.throttle, 0);
  assert.equal(b.throttle, 0);
});
