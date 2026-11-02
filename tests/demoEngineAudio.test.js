import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineAudio } from '../src/demo/engineAudio.js';

class Param {
  constructor(value = 0) { this.value = value; this.targets = []; }
  setTargetAtTime(value, time, smoothing) { this.targets.push({ value, time, smoothing }); }
  cancelScheduledValues(time) { this.targets = this.targets.filter(event => event.time < time); }
  get target() { return this.targets.at(-1)?.value; }
}

class Node {
  constructor(kind) {
    this.kind = kind;
    this.gain = new Param();
    this.frequency = new Param(440);
    this.Q = new Param(1);
    this.pan = new Param();
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
  constructor() { this.currentTime = 1; this.sampleRate = 8000; this.nodes = []; }
  make(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.make('gain'); }
  createOscillator() { return this.make('oscillator'); }
  createStereoPanner() { return this.make('panner'); }
  createBufferSource() { return this.make('buffer'); }
  createBiquadFilter() { return this.make('filter'); }
  createBuffer(channels, length) {
    const samples = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: channel => samples[channel] };
  }
}

test('engine voice starts silent, fades selection and reuses sources on power changes', () => {
  const ctx = new Context();
  const voice = createEngineAudio(ctx, {});
  const master = ctx.nodes[0];
  const sources = ctx.nodes.filter(node => node.kind === 'oscillator' || node.kind === 'buffer');
  assert.equal(master.gain.value, 0);
  assert.ok(sources.length > 0);
  assert.ok(sources.every(source => source.starts === 1));

  voice.setPower(0.5);
  voice.setEnabled(true);
  assert.equal(master.gain.target, 1);
  voice.setPower(1);
  voice.setEnabled(false);
  assert.equal(master.gain.target, 0);
  voice.setEnabled(true);
  assert.equal(master.gain.target, 1);
  assert.ok(sources.every(source => source.starts === 1 && source.stops === 0));

  voice.dispose();
  assert.ok(sources.every(source => source.stops === 1));
  assert.ok(ctx.nodes.every(node => node.connections.length === 0));
  assert.equal(sources.find(source => source.kind === 'buffer').buffer, null);
  voice.dispose();
  voice.setPower(0.2);
  voice.setEnabled(false);
  assert.ok(sources.every(source => source.stops === 1));
  assert.equal(master.gain.target, 1);
});

test('engine power controls pitch and level with finite, bounded automation', () => {
  const ctx = new Context();
  const voice = createEngineAudio(ctx, {});
  const oscillators = ctx.nodes.filter(node => node.kind === 'oscillator');
  const gains = ctx.nodes.filter(node => node.kind === 'gain');
  voice.setPower(0.2);
  const lowPitch = oscillators[0].frequency.target;
  const lowLevel = gains[1].gain.target;
  voice.setPower(0.8);
  assert.ok(oscillators[0].frequency.target > lowPitch);
  assert.ok(gains[1].gain.target > lowLevel);

  voice.setPower(Infinity);
  const idle = gains[1].gain.target;
  assert.ok(idle > 0 && idle < lowLevel);
  voice.setPower(-4);
  assert.equal(gains[1].gain.target, idle);
  voice.setPower(4);
  const maxPitch = oscillators[0].frequency.target;
  voice.setPower(1);
  assert.equal(oscillators[0].frequency.target, maxPitch);
  voice.setPower(NaN);
  for (const node of ctx.nodes) {
    for (const param of [node.gain, node.frequency, node.Q, node.pan]) {
      assert.ok(param.targets.every(event => Number.isFinite(event.value) && event.smoothing > 0));
    }
  }
  assert.equal(gains[1].gain.target, idle);
  voice.dispose();
});

test('noise uses an overlapped loop with a continuous seam', () => {
  const ctx = new Context();
  const voice = createEngineAudio(ctx, {});
  const source = ctx.nodes.find(node => node.kind === 'buffer');
  assert.equal(source.loop, true);
  const loopLength = Math.round(source.loopEnd * ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = source.buffer.getChannelData(channel);
    const seam = Math.abs(samples[0] - samples[loopLength - 1]);
    assert.ok(seam < 1e-6);
  }
  voice.dispose();
});

test('large power increases add a short, bounded air surge without retriggering on small changes', () => {
  const ctx = new Context();
  const voice = createEngineAudio(ctx, {});
  voice.setEnabled(true);
  voice.setPower(0.25);
  ctx.currentTime = 2;
  const gains = ctx.nodes.filter(node => node.kind === 'gain');
  const eventCounts = gains.map(node => node.gain.targets.length);
  voice.setPower(0.26);
  const hasSurge = (node, count) => {
    const added = node.gain.targets.slice(count);
    return added.some((event, index) => event.value > 0 && added[index + 1]?.value === 0 && added[index + 1].time > event.time);
  };
  assert.equal(gains.some((node, i) => hasSurge(node, eventCounts[i])), false);

  const beforeJump = gains.map(node => node.gain.targets.length);
  voice.setPower(0.9);
  const surge = gains.find((node, i) => hasSurge(node, beforeJump[i]));
  assert.ok(surge);
  const events = surge.gain.targets.slice(beforeJump[gains.indexOf(surge)]);
  assert.ok(events[0].value <= 0.025);
  assert.ok(events[0].smoothing > 0 && events[1].smoothing > 0);
  voice.dispose();
});
