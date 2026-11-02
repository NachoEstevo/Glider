import test from 'node:test';
import assert from 'node:assert/strict';
import { worldHeight } from '../src/world/worldHeight.js';

test('beach profile remains continuous where it meets higher ground', () => {
  // This transect crosses the 4 m transition on an island beach.
  const z = -3700;
  let left = -1640, right = -1630;
  assert.ok(worldHeight(left, z) < 4 && worldHeight(right, z) > 4);
  for (let i = 0; i < 30; i++) {
    const mid = (left + right) / 2;
    if (worldHeight(mid, z) < 4) left = mid;
    else right = mid;
  }
  assert.ok(worldHeight(right, z) - worldHeight(left, z) < 0.001);
});
