import test from 'node:test';
import assert from 'node:assert/strict';
import { FlightSession, FlightEnding } from '../src/story/ending.js';

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
  const flight = { pos: { x: 0, y: 30, z: 0 }, heading: 0.4, throttle: 1, speed: 34, bank: .4, pitch: .2, vSpeed: 0 };
  const rig = { zoom: 1 };
  const ending = new FlightEnding();
  ending.begin(flight, rig);
  for (let i = 0; i < 180; i++) {
    ending.update(.1, flight, rig, () => 50);
    assert.ok(flight.pos.y >= 64);
  }
  assert.ok(ending.finished);
  assert.equal(ending.fade, 1);
  assert.equal(flight.throttle, 0);
  for (const value of Object.values(flight.pos)) assert.ok(Number.isFinite(value));
});

test('final glide preserves low water altitude without an upward jump', () => {
  const flight = { pos: { x: 0, y: 6.9, z: 0 }, heading: 0, throttle: 1, speed: 34, bank: 0, pitch: 0, vSpeed: 0 };
  const rig = { zoom: 1 };
  const ending = new FlightEnding();
  ending.begin(flight, rig);
  for (let i = 0; i < 180; i++) {
    ending.update(.1, flight, rig, () => -20);
    assert.equal(flight.pos.y, 6.9);
  }
  assert.ok(ending.finished);
});
