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

test('selected weathered buildings have actual open bays and a core behind them', async () => {
  const THREE = await import('three');
  const item = { x: 0, z: 0, y: -3, w: 20, d: 16, h: 20, hb: 20, yaw: 0, lean: 0, leanDir: 0, arch: 'intact', seed: 10, ledge: 0, balc: false };
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const [mesh] = buildRuinMeshes([item], material, ruinFrame, () => 0);
  const ray = new THREE.Raycaster(new THREE.Vector3(-7.5, 2, 20), new THREE.Vector3(0, 0, -1));
  const hits = ray.intersectObject(mesh);
  assert.ok(hits.length > 0);
  assert.ok(hits[0].point.z < 4, 'open bay must expose the recessed interior');
  ray.set(new THREE.Vector3(-9.5, 2, 20), new THREE.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(mesh)[0].point.z > 7.5, 'the structural edge pier remains');
  mesh.geometry.dispose();
  material.dispose();
});
