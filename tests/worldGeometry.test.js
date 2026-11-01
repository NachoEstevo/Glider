import test from 'node:test';
import assert from 'node:assert/strict';
import { crownGeometry, trunkGeometry } from '../src/world/treeGeometry.js';
import { planRuins, ruinFrame } from '../src/world/ruins.js';
import { buildRuinMeshes } from '../src/world/ruinGeometry.js';

function validateGeometry(g) {
  const count = g.attributes.position.count;
  for (const attribute of Object.values(g.attributes)) {
    assert.equal(attribute.count, count);
    assert.ok(attribute.array.every(Number.isFinite), 'geometry attributes must remain finite');
  }
  assert.ok(g.index.array.every(index => index < count), 'indices must reference existing vertices');
  g.computeBoundingSphere();
  assert.ok(Number.isFinite(g.boundingSphere.radius) && g.boundingSphere.radius > 0);
}

test('branched trees keep valid geometry, bark UVs and an instancing budget', () => {
  const seed = () => { let state = 7; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296); };
  const crown = crownGeometry(seed()), repeat = crownGeometry(seed()), trunk = trunkGeometry();
  for (const g of [crown, trunk]) {
    validateGeometry(g);
    assert.ok(g.attributes.uv);
    assert.ok(g.index.count / 3 <= 300, 'per-tree geometry is multiplied across thousands of instances');
  }
  assert.deepEqual(crown.attributes.position.array, repeat.attributes.position.array);
  for (const g of [crown, repeat, trunk]) g.dispose();
});

test('the complete drowned-city plan generates finite indexed architecture within budget', () => {
  const plan = planRuins();
  const meshes = buildRuinMeshes(plan.items.concat(plan.props), null, ruinFrame, () => 0);
  let triangles = 0;
  for (const mesh of meshes) {
    validateGeometry(mesh.geometry);
    triangles += mesh.geometry.index.count / 3;
    mesh.geometry.dispose();
  }
  assert.ok(triangles < 1_000_000, 'architecture must retain a bounded full-world geometry budget');
});
