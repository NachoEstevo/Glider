import test from 'node:test';
import assert from 'node:assert/strict';
import { Soundtrack } from '../src/audio/soundtrack.js';
import { createWingWaterAudio } from '../src/audio/wingWaterAudio.js';
import { WingWake } from '../src/water/WingWake.js';
import * as THREE from 'three';

class Param {
  constructor(value = 0) { this.value = value; this.targets = []; }
  setTargetAtTime(value, time, smoothing) { this.targets.push({ value, time, smoothing }); }
  get last() { return this.targets.at(-1); }
}

class AudioNode {
  constructor(kind) {
    this.kind = kind;
    this.gain = new Param();
    this.frequency = new Param();
    this.Q = new Param();
    this.pan = new Param();
    this.playbackRate = new Param(1);
    this.connections = [];
    this.starts = 0;
    this.stops = 0;
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections = []; }
  start() { this.starts++; }
  stop() { this.stops++; }
}

class Context {
  constructor() { this.currentTime = 3; this.sampleRate = 8000; this.nodes = []; }
  make(kind) { const node = new AudioNode(kind); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createStereoPanner() { return this.make('panner'); }
  createBufferSource() { return this.make('buffer'); }
  createBiquadFilter() { return this.make('filter'); }
  createOscillator() { return this.make('oscillator'); }
  createBuffer(channels, length, sampleRate = this.sampleRate) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: channel => samples[channel] };
  }
  async decodeAudioData() { return this.decoded; }
}

function sample(ctx) {
  const buffer = ctx.createBuffer(2, ctx.sampleRate * 2);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * (0.04 + channel * 0.01)) * 0.2;
  }
  return buffer;
}

function mockSampleFetch(t, response = Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })) {
  return t.mock.method(globalThis, 'fetch', () => response);
}

test('soundtrack forwards contact and ignores it during the ending fade', () => {
  const calls = [], sound = Object.create(Soundtrack.prototype);
  sound.ctx = { currentTime: 3 };
  sound.wingWater = { update: (...args) => calls.push(args) };
  sound.setWingWaterContact(0.8, -1, 58);
  sound.setWingWaterContact(0, 1);
  sound.finishing = true;
  sound.setWingWaterContact(1, 1);
  assert.deepEqual(calls, [[0.8, -1, 58], [0, 1, 34]]);
});

test('contact before samples load fades in and later updates reuse all sources', async t => {
  const ctx = new Context();
  ctx.decoded = sample(ctx);
  let resolveFetch;
  const pendingFast = new Promise(resolve => { resolveFetch = resolve; });
  const fetchMock = t.mock.method(globalThis, 'fetch', url => url.endsWith('fast.mp3')
    ? pendingFast : Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  const output = {};
  const water = createWingWaterAudio(ctx, output);
  const panner = ctx.nodes.find(node => node.kind === 'panner' && node.connections.includes(output));
  const contact = ctx.nodes.find(node => node.kind === 'gain' && node.connections.includes(panner));
  assert.ok(contact && panner);
  assert.equal(contact.gain.value, 0);
  water.update(0.8, -1, 75);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.nodes.filter(node => node.kind === 'buffer').length, 0);
  resolveFetch({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  assert.equal(await water.ready, true);
  assert.deepEqual(fetchMock.mock.calls.map(call => call.arguments[0]).sort(), [
    '/audio/sfx/wing_skim_fast.mp3', '/audio/sfx/wing_skim_loop.mp3', '/audio/sfx/wing_skim_slow.mp3',
  ]);
  const sources = ctx.nodes.filter(node => node.kind === 'buffer' || node.kind === 'oscillator');
  assert.equal(sources.length, 3);
  assert.ok(sources.every(source => source.starts === 1 && source.playbackRate.value === 1));
  assert.ok(sources[2].connections[0].gain.last.value > 0, 'the retained fast speed is applied on load');
  assert.ok(contact.gain.last.value > 0 && contact.gain.last.smoothing > 0);
  assert.ok(panner.pan.last.value < 0 && panner.pan.last.smoothing > 0);

  water.update(0.2, -1);
  const low = contact.gain.last;
  assert.ok(low.value > 0 && low.smoothing > 0);
  assert.ok(panner.pan.last.value < 0 && panner.pan.last.smoothing > 0);
  water.update(0.8, 1);
  assert.ok(contact.gain.last.value > low.value);
  assert.ok(panner.pan.last.value > 0);
  water.update(2, 5);
  const max = contact.gain.last.value;
  const right = panner.pan.last.value;
  water.update(1, 1);
  assert.equal(contact.gain.last.value, max);
  assert.equal(panner.pan.last.value, right);
  assert.ok(right <= 1);

  water.update(NaN, Infinity);
  assert.equal(contact.gain.last.value, 0);
  assert.equal(panner.pan.last.value, 0);
  assert.ok(contact.gain.last.smoothing > low.smoothing);
  for (let i = 0; i < 100; i++) water.update(i % 2, -1);
  assert.equal(ctx.nodes.filter(node => node.kind === 'buffer' || node.kind === 'oscillator').length, sources.length);
  assert.ok(sources.every(source => source.starts === 1 && source.stops === 0));

  water.dispose();
  water.dispose();
  const targetCount = contact.gain.targets.length;
  water.update(1, 1);
  assert.equal(contact.gain.targets.length, targetCount);
  assert.ok(sources.every(source => source.stops === 1));
  assert.ok(ctx.nodes.every(node => node.connections.length === 0));
  assert.ok(sources.every(source => source.buffer === null));
});

test('speed smoothly blends the three pitch-preserved clips with bounded gain', async t => {
  const ctx = new Context();
  ctx.decoded = sample(ctx);
  mockSampleFetch(t);
  const water = createWingWaterAudio(ctx, {});
  assert.equal(await water.ready, true);
  const sources = ctx.nodes.filter(node => node.kind === 'buffer');
  const levels = sources.map(source => source.connections[0].gain);
  const targets = () => levels.map(level => level.last.value);

  water.update(1, 0, 20);
  const slow = targets();
  assert.ok(slow[0] > 0 && slow[1] === 0 && slow[2] === 0);
  water.update(1, 0, 42);
  const normal = targets();
  assert.ok(normal[1] > 0 && normal[0] === 0 && normal[2] === 0);
  water.update(1, 0, 75);
  const fast = targets();
  assert.ok(fast[2] > 0 && fast[0] === 0 && fast[1] === 0);

  water.update(1, 0, 31);
  const halfway = targets();
  assert.ok(Math.abs(halfway[0] - slow[0] / 2) < 1e-9);
  assert.ok(Math.abs(halfway[1] - normal[1] / 2) < 1e-9);
  assert.equal(halfway[2], 0);
  assert.ok(levels.every(level => level.last.smoothing > 0));
  water.update(1, 0, -100);
  assert.deepEqual(targets(), slow);
  water.update(1, 0, 1000);
  assert.deepEqual(targets(), fast);
  water.update(1, 0, NaN);
  const fallback = targets();
  water.update(1, 0, 34);
  assert.deepEqual(targets(), fallback);
  assert.ok(sources.every(source => source.playbackRate.value === 1 && source.playbackRate.targets.length === 0 && source.starts === 1));
  water.dispose();
});

test('sample is crossfaded into a seamless loop without replacing it with synthetic noise', async t => {
  const ctx = new Context();
  ctx.decoded = sample(ctx);
  mockSampleFetch(t);
  const water = createWingWaterAudio(ctx, {});
  assert.equal(await water.ready, true);
  const sources = ctx.nodes.filter(node => node.kind === 'buffer');
  assert.equal(sources.length, 3);
  for (const source of sources) {
    assert.equal(source.loop, true);
    const end = Math.round(source.loopEnd * ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = source.buffer.getChannelData(channel);
      assert.ok(Math.abs(samples[0] - samples[end - 1]) < 1e-6);
      assert.equal(samples[Math.floor(end / 2)], ctx.decoded.getChannelData(channel)[Math.floor(end / 2)]);
    }
  }
  water.dispose();
});

test('one missing sample or a failed decode stays silent and settles readiness', async t => {
  const ctx = new Context();
  ctx.decoded = sample(ctx);
  const fetchMock = t.mock.method(globalThis, 'fetch', async url => url.endsWith('fast.mp3')
    ? { ok: false } : { ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  const water = createWingWaterAudio(ctx, {});
  water.update(1, 1);
  assert.equal(await water.ready, false);
  assert.equal(ctx.nodes.filter(node => node.kind === 'buffer').length, 0);
  water.dispose();

  fetchMock.mock.mockImplementation(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  ctx.decodeAudioData = async () => { throw new Error('bad audio'); };
  const failedDecode = createWingWaterAudio(ctx, {});
  assert.equal(await failedDecode.ready, false);
  failedDecode.dispose();
});

test('disposal during decoding never starts a late source', async t => {
  const ctx = new Context();
  mockSampleFetch(t);
  const resolveDecodes = [];
  ctx.decodeAudioData = () => new Promise(resolve => { resolveDecodes.push(resolve); });
  const water = createWingWaterAudio(ctx, {});
  await new Promise(resolve => setImmediate(resolve));
  water.update(1, 1);
  water.dispose();
  assert.equal(resolveDecodes.length, 3);
  for (const resolve of resolveDecodes) resolve(sample(ctx));
  assert.equal(await water.ready, false);
  assert.equal(ctx.nodes.filter(node => node.kind === 'buffer').length, 0);
  assert.ok(ctx.nodes.every(node => node.connections.length === 0));
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


test('ambience creates three looping wing sources and contact updates never restart them', async t => {
  const sound = Object.create(Soundtrack.prototype);
  sound.ctx = new Context();
  sound.ctx.decoded = sample(sound.ctx);
  mockSampleFetch(t);
  sound.master = new AudioNode('output');
  sound._ambience();
  assert.equal(await sound.wingWater.ready, true);
  const sources = sound.ctx.nodes.filter(node => node.kind === 'buffer');
  assert.equal(sources.length, 5); // wind, sea, and the three wing-speed samples
  assert.ok(sources.every(source => source.starts === 1));
  for (let i = 0; i < 100; i++) sound.setWingWaterContact(i % 2, 1);
  assert.equal(sound.ctx.nodes.filter(node => node.kind === 'buffer').length, 5);
  assert.ok(sources.every(source => source.starts === 1));
});
