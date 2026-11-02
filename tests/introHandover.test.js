import test from 'node:test';
import assert from 'node:assert/strict';
import { Intro } from '../src/story/intro.js';

function setup() {
  const calls = { ready: 0, handover: 0, reveal: 0 };
  const ui = { showIntro() {}, setPilot() {}, setAi() {}, setSys() {}, showLog() {}, subtitle() {} };
  const soundtrack = { voiceIdle: () => true, stopVoice() {}, playVoice: () => 0, duration: () => 1 };
  const intro = new Intro({ dialogue: { lines: [], worldRevealAt: 1, handoverAt: 2 }, soundtrack, ui,
    onReveal: () => calls.reveal++, onReady: () => calls.ready++, onHandover: () => calls.handover++ });
  return { intro, calls };
}
test('natural intro waits for explicit handover and signals readiness once', () => {
  const { intro, calls } = setup();
  intro.update(2); intro.update(3);
  assert.deepEqual(calls, { ready: 1, handover: 0, reveal: 1 });
  assert.equal(intro.readyForHandover, true);
  intro.skip(); intro.skip();
  assert.equal(calls.handover, 1);
});
test('skipping the intro immediately reveals and hands over without prompting', () => {
  const { intro, calls } = setup();
  intro.skip(); intro.update(10);
  assert.deepEqual(calls, { ready: 0, handover: 1, reveal: 1 });
});
