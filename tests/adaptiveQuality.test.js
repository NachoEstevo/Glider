import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQuality } from '../src/engine/AdaptiveQuality.js';

test('sustained slow frames lower resolution within a bounded budget', () => {
  const quality = new AdaptiveQuality();
  for (let i = 0; i < 900; i++) quality.sample(33.3);
  assert.equal(quality.resolution, 0.65);
  for (let i = 0; i < 5000; i++) quality.sample(16.7);
  assert.equal(quality.resolution, 1);
});

test('55 Hz displays, isolated spikes and hidden-tab gaps retain quality', () => {
  const quality = new AdaptiveQuality();
  for (let i = 0; i < 1800; i++) quality.sample(i % 300 === 0 ? 70 : 18.2);
  assert.equal(quality.resolution, 1);
  for (const value of [2000, NaN, 0, -1]) assert.equal(quality.sample(value), null);
  assert.equal(quality.resolution, 1);
  quality.enabled = false;
  for (let i = 0; i < 1000; i++) quality.sample(50);
  assert.equal(quality.resolution, 1);
});
