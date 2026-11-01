import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { partitionVegetation } from '../src/world/vegetationBatches.js';

test('partition preserves all instance matrices, colors, shared resources, and shadow settings', () => {
  const geometry = new THREE.BoxGeometry(2, 4, 2);
  const material = new THREE.MeshBasicMaterial();
  const source = new THREE.InstancedMesh(geometry, material, 5);
  const positions = [[0, 0, 0], [-1, 3, -1], [255, 2, 2], [256, 4, 2], [-257, 5, 0]];
  const expected = new Map();
  positions.forEach(([x, y, z], i) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), new THREE.Vector3(i + 1, 1, 2));
    const color = new THREE.Color(i / 5, 0.4, 0.8);
    source.setMatrixAt(i, matrix);
    source.setColorAt(i, color);
    expected.set(`${x},${y},${z}`, { matrix: [...source.instanceMatrix.array.slice(i * 16, i * 16 + 16)], color: [...source.instanceColor.array.slice(i * 3, i * 3 + 3)] });
  });
  source.castShadow = true;
  let disposed = 0;
  source.addEventListener('dispose', () => disposed++);
  const batches = partitionVegetation(source);
  assert.equal(batches.length, 4);
  assert.equal(disposed, 1);
  assert.equal(batches.reduce((n, b) => n + b.count, 0), positions.length);
  const matrix = new THREE.Matrix4();
  for (const batch of batches) {
    assert.equal(batch.geometry, geometry);
    assert.equal(batch.material, material);
    assert.equal(batch.castShadow, true);
    assert.equal(batch.receiveShadow, false);
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix);
      const e = matrix.elements;
      const key = `${e[12]},${e[13]},${e[14]}`;
      const original = expected.get(key);
      assert.ok(original, `unexpected instance ${key}`);
      assert.deepEqual(e, original.matrix);
      assert.deepEqual([...batch.instanceColor.array.slice(i * 3, i * 3 + 3)], original.color);
      geometry.computeBoundingSphere();
      const instanceSphere = geometry.boundingSphere.clone().applyMatrix4(matrix);
      assert.ok(batch.boundingSphere.center.distanceTo(instanceSphere.center) + instanceSphere.radius <= batch.boundingSphere.radius + 1e-5);
      expected.delete(key);
    }
  }
  assert.equal(expected.size, 0);
});

test('empty and uncolored meshes are supported', () => {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  assert.deepEqual(partitionVegetation(new THREE.InstancedMesh(geometry, material, 0)), []);
  const batches = partitionVegetation(new THREE.InstancedMesh(geometry, material, 1));
  assert.equal(batches[0].instanceColor, null);
  assert.throws(() => partitionVegetation(batches[0], 0), RangeError);
});

test('distance visibility has hysteresis and reports only shadow-casting changes', async () => {
  const { updateVegetationDistance } = await import('../src/world/vegetationBatches.js');
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 1);
  mesh.castShadow = true;
  const [batch] = partitionVegetation(mesh);
  const radius = batch.boundingSphere.radius;
  const positionAt = (distance) => new THREE.Vector3(distance + radius, 0, 0);
  assert.equal(updateVegetationDistance([batch], positionAt(421), 400), true);
  assert.equal(batch.visible, false);
  assert.equal(updateVegetationDistance([batch], positionAt(400), 400), false);
  assert.equal(batch.visible, false);
  assert.equal(updateVegetationDistance([batch], positionAt(379), 400), true);
  assert.equal(batch.visible, true);
  batch.castShadow = false;
  assert.equal(updateVegetationDistance([batch], positionAt(421), 400), false);
  assert.equal(batch.visible, false);
});
