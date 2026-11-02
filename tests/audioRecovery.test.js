import test from 'node:test';
import assert from 'node:assert/strict';
import { Soundtrack } from '../src/audio/soundtrack.js';

class FakeAudio extends EventTarget {
  constructor() { super(); this.paused = true; this.ended = false; this.currentTime = 0; this.readyState = 4; this.error = null; this.plays = 0; }
  canPlayType() { return 'probably'; }
  async play() { this.plays++; if (this.reject) throw this.reject; this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  load() { this.paused = true; this.currentTime = 0; }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.destination = {}; this.sources = 0; this.state = 'running'; }
  createGain() { return { gain: { value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect(x) { return x; } }; }
  createMediaElementSource() { this.sources++; return { connect(x) { return x; } }; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}
globalThis.Audio = FakeAudio;
globalThis.AudioContext = FakeContext;
function setup() {
  const s = new Soundtrack({ tracks: [], dialogue: { lines: [] } });
  s._ambience = () => {}; s._loadVoices = () => {}; s._loadSfx = () => {};
  const states = []; s.onMusicState = state => states.push(state);
  return { s, states };
}

test('visibility pauses and resumes the existing graph, preserving time', async () => {
  const { s, states } = setup(); await s.start(); s.music.currentTime = 42;
  await s.handleVisibility(true); assert.equal(s.ctx.state, 'suspended'); assert.equal(s.music.paused, true);
  await s.handleVisibility(false); assert.equal(s.music.currentTime, 42); assert.equal(s.ctx.state, 'running');
  assert.equal(s.music.paused, false); assert.equal(s.ctx.sources, 1); assert.equal(states.at(-1), 'playing');
});
test('intentional pause is not resumed after visibility change', async () => {
  const { s } = setup(); await s.start(); s.music.pause(); await s.handleVisibility(true); await s.handleVisibility(false);
  assert.equal(s.music.plays, 1); assert.equal(s.musicDiagnostic.state, 'paused');
});
test('blocked play is recoverable by a gesture', async () => {
  const { s } = setup(); s.music.reject = Object.assign(new Error(), { name: 'NotAllowedError' }); await s.start();
  assert.equal(s.musicDiagnostic.state, 'blocked'); assert.equal(s.started, false); delete s.music.reject; await s.resumeMusic();
  assert.equal(s.started, true);
  assert.equal(s.musicDiagnostic.state, 'playing'); assert.equal(s.ctx.sources, 1);
});
test('media error tries alternate source at the saved time; natural ending never restarts', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 37; s.music.dispatchEvent(new Event('error'));
  assert.match(s.music.src, /m4a$/); s.music.dispatchEvent(new Event('loadedmetadata')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.music.currentTime, 37); assert.equal(s.music.paused, false);
  s.music.ended = true; s.music.dispatchEvent(new Event('ended')); const plays = s.music.plays;
  await s.handleVisibility(true); await s.handleVisibility(false); await s.resumeMusic();
  assert.equal(s.music.plays, plays); assert.equal(s.musicDiagnostic.state, 'ended');
});
test('finish prevents pending play from restarting', async () => {
  const { s } = setup(); await s.start(); s.music.pause(); let resolve;
  s.music.play = () => new Promise(r => { resolve = () => { s.music.paused = false; r(); }; });
  const pending = s.resumeMusic(); await Promise.resolve(); s.finish(); resolve(); await pending;
  assert.equal(s.music.paused, true); assert.equal(s.musicDiagnostic.state, 'ended');
});

test('pending fallback metadata restores position after a hidden and visible transition', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 73; s.music.dispatchEvent(new Event('error'));
  await s.handleVisibility(true); await s.handleVisibility(false);
  assert.equal(s.music.currentTime, 0);
  s.music.dispatchEvent(new Event('loadedmetadata')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.music.currentTime, 73); assert.equal(s.music.paused, false);
});
test('waiting alone never switches format and a pause prevents an automatic retry', async () => {
  const { s } = setup(); await s.start(); const source = s.music.src;
  s.music.dispatchEvent(new Event('waiting')); assert.equal(s.musicDiagnostic.state, 'buffering');
  s.music.pause(); assert.equal(s.music.src, source); assert.equal(s.musicDiagnostic.state, 'paused');
  s._clearStall();
});


test('hiding during the first pending play resumes on return', async () => {
  const { s } = setup(); let resolveFirst;
  s.music.play = () => {
    s.music.plays++;
    if (s.music.plays === 1) return new Promise(resolve => { resolveFirst = resolve; });
    s.music.paused = false; return Promise.resolve();
  };
  const pending = s.start(); await Promise.resolve();
  await s.handleVisibility(true); await s.handleVisibility(false);
  resolveFirst(); await pending;
  assert.equal(s.started, true); assert.equal(s.music.paused, false);
  assert.equal(s.ctx.sources, 1); assert.equal(s.music.plays, 2);
});


test('two media errors can be retried at the original playhead after repair', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 890;
  s.music.dispatchEvent(new Event('error'));
  assert.equal(s.music.currentTime, 0);
  s.music.dispatchEvent(new Event('error')); assert.equal(s.musicDiagnostic.state, 'error');
  const retry = s.resumeMusic();
  assert.equal(s.music.plays, 2);
  s.music.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(await retry, true); assert.equal(s.music.currentTime, 890);
  assert.equal(s.musicDiagnostic.state, 'playing'); assert.equal(s.ctx.sources, 1);
});

test('hiding while retry waits for metadata cancels it and retains recovery', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 52;
  s.music.dispatchEvent(new Event('error')); s.music.dispatchEvent(new Event('error'));
  const retry = s.resumeMusic(); await s.handleVisibility(true); await retry;
  s.music.dispatchEvent(new Event('loadedmetadata')); await s.handleVisibility(false);
  assert.equal(s.musicDiagnostic.state, 'error'); assert.equal(s.music.paused, true);
  const again = s.resumeMusic(); s.music.dispatchEvent(new Event('loadedmetadata')); await again;
  assert.equal(s.music.currentTime, 52); assert.equal(s.musicDiagnostic.state, 'playing');
});


test('initial blocked playback rejoins the fallback clock', async () => {
  const { s } = setup(); s.music.reject = Object.assign(new Error(), { name: 'NotAllowedError' });
  await s.start(); assert.equal(s.started, false); delete s.music.reject;
  await s.resumeMusic(100); assert.equal(s.music.currentTime, 100); assert.equal(s.started, true);
});

test('initial recovery waits for metadata and keeps the requested position', async () => {
  const { s } = setup(); s.music.reject = Object.assign(new Error(), { name: 'NotAllowedError' });
  await s.start(); delete s.music.reject; s.music.readyState = 0;
  const pending = s.resumeMusic(100); assert.equal(s.music.plays, 2);
  s.music.readyState = 1; s.music.dispatchEvent(new Event('loadedmetadata')); await pending;
  assert.equal(s.music.currentTime, 100); assert.equal(s.started, true);
});

test('explicit position overrides saved time during error retry', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 30;
  s.music.dispatchEvent(new Event('error')); s.music.dispatchEvent(new Event('error'));
  const pending = s.resumeMusic(100); s.music.dispatchEvent(new Event('loadedmetadata')); await pending;
  assert.equal(s.music.currentTime, 100);
});


test('requested position updates an in-progress fallback', async () => {
  const { s } = setup(); await s.start(); s.music.currentTime = 30; s.music.dispatchEvent(new Event('error'));
  await s.resumeMusic(100); s.music.dispatchEvent(new Event('loadedmetadata'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.music.currentTime, 100); assert.equal(s.music.paused, false);
});


test('preview position survives a deferred fallback after initial playback failure', async () => {
  const { s } = setup();
  s.music.reject = Object.assign(new Error(), { name: 'NotSupportedError' });
  await s.start(); assert.equal(s.started, false);
  s.music.dispatchEvent(new Event('error'));
  await s.resumeMusic(892);
  delete s.music.reject; s.music.dispatchEvent(new Event('loadedmetadata'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.music.currentTime, 892); assert.equal(s.started, true);
  assert.equal(s.music.plays, 2); assert.equal(s.ctx.sources, 1);
});


test('initial automatic fallback does not restart behind the silent session clock', async () => {
  const { s } = setup(); s.music.reject = Object.assign(new Error(), { name: 'NotSupportedError' });
  await s.start(); s.music.dispatchEvent(new Event('error')); delete s.music.reject;
  s.music.dispatchEvent(new Event('loadedmetadata')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.started, false); assert.equal(s.music.plays, 1); assert.equal(s.musicDiagnostic.state, 'paused');
  await s.resumeMusic(37); assert.equal(s.music.currentTime, 37); assert.equal(s.started, true);
});

test('initial fallback hidden while buffering waits for a synchronized user retry', async () => {
  const { s } = setup(); s.music.reject = Object.assign(new Error(), { name: 'NotSupportedError' });
  await s.start(); s.music.dispatchEvent(new Event('error')); delete s.music.reject;
  await s.handleVisibility(true); s.music.dispatchEvent(new Event('loadedmetadata'));
  await s.handleVisibility(false); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.started, false); assert.equal(s.music.plays, 1);
  await s.resumeMusic(37); assert.equal(s.music.currentTime, 37); assert.equal(s.started, true);
});

test('volume preference survives reload and mute restores the selected level', async t => {
  const previous = globalThis.localStorage;
  const values = new Map([['glider.volume', '.35']]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const { s } = setup();
  await s.start();
  assert.equal(s.master.gain.value, .35);
  let target;
  s.master.gain.setTargetAtTime = value => { target = value; };
  s.toggleMute(); assert.equal(target, 0);
  s.toggleMute(); assert.equal(target, .35);
  s.toggleMute(); s.setVolume(.6);
  assert.equal(s.muted, false);
  assert.equal(target, .6);
  assert.equal(setup().s.volume, .6);
  s.finish(); target = undefined; s.setVolume(.4);
  assert.equal(target, undefined, 'volume must not interrupt the ending fade');
});

test('volume accepts zero, clamps its range and tolerates unavailable storage', async t => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('Unavailable'); }, setItem() { throw new Error('Unavailable'); } };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const { s } = setup();
  assert.equal(s.volume, 1);
  s.setVolume(2); assert.equal(s.volume, 1);
  s.setVolume(-1); assert.equal(s.volume, 0);
  s.setVolume(NaN); assert.equal(s.volume, 0);
  await s.start(); assert.equal(s.master.gain.value, 0);
});
