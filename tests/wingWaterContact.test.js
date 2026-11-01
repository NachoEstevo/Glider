import test from 'node:test';
import assert from 'node:assert/strict';
import { Soundtrack } from '../src/audio/soundtrack.js';
import { WingWake } from '../src/water/WingWake.js';
import * as THREE from 'three';

test('wing sound changes continuous gain and pan without restarting a source', () => {
  const calls = [], sound = Object.create(Soundtrack.prototype);
  sound.ctx = { currentTime: 3 };
  sound.wingWaterGain = { gain: { setTargetAtTime: (...args) => calls.push(['gain', ...args]) } };
  sound.wingWaterPan = { pan: { setTargetAtTime: (...args) => calls.push(['pan', ...args]) } };
  sound.setWingWaterContact(0.8, -1);
  sound.setWingWaterContact(0.8, -1);
  sound.setWingWaterContact(0, -1);
  assert.ok(calls[0][1] > 0);
  assert.equal(calls[1][1], -0.75);
  assert.equal(calls[4][1], 0);
  assert.ok(calls[4][3] > calls[0][3]);
  sound.finishing = true;
  sound.setWingWaterContact(1, 1);
  assert.equal(calls.length, 6);
});

test('contact signal rises while grazing and decays after the wing lifts', () => {
  const impacts = Array.from({length: 8}, () => new THREE.Vector4());
  const wake = new WingWake({uniforms: {uImpact: {value: impacts}, uImpactSize: {value: Array(8).fill(1)}}});
  const tips = [new THREE.Object3D(), new THREE.Object3D()];
  tips[0].position.set(10000, 0.2, 10000);
  tips[1].position.set(10000, 10, 10000);
  const flight = { speed: 34, bank: 0.65, obstacleTop: () => -Infinity };
  for (let i = 0; i < 30; i++) wake.update(1 / 60, tips, flight);
  assert.ok(wake.contactStrength > 0.9);
  assert.ok(wake.contactPan > 0.9);
  assert.equal(wake.contactPoint.x, 10000);
  tips[0].position.y = 10;
  for (let i = 0; i < 120; i++) wake.update(1 / 60, tips, flight);
  assert.ok(wake.contactStrength < 0.001);
});


test('ambience creates one looping wing source and contact updates never restart it', () => {
  let sources = 0, starts = 0;
  const param = () => ({ value: 0, setTargetAtTime() {} });
  const node = () => ({ connect(next) { return next; }, gain: param(), frequency: param(), Q: param(), pan: param(), playbackRate: param(), start() { starts++; } });
  const sound = Object.create(Soundtrack.prototype);
  sound.master = node();
  sound.ctx = {
    currentTime: 0, sampleRate: 8,
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createBufferSource: () => { sources++; return node(); },
    createBiquadFilter: node, createGain: node, createStereoPanner: node,
    createOscillator: node,
  };
  sound._ambience();
  assert.equal(sources, 3); // wind, sea, and one wing source
  const initialStarts = starts;
  for (let i = 0; i < 100; i++) sound.setWingWaterContact(i % 2, 1);
  assert.equal(sources, 3);
  assert.equal(starts, initialStarts);
});
