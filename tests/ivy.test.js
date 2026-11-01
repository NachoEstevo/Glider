import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIvy } from '../src/world/ivy.js';

function makeIvy() {
  let seed = 17;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  return createIvy([{ p: new THREE.Vector3(10, 20, 30), q: new THREE.Quaternion(), w: 8, h: 10 }], () => {}, rand);
}

test('ivy stems retain a cross-section and geometry is finite and deterministic', () => {
  const first = makeIvy(), second = makeIvy();
  for (let i = 0; i < first.children.length; i++) {
    const mesh = first.children[i], again = second.children[i], geometry = mesh.geometry;
    assert.ok(geometry.attributes.position.count > 0);
    assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
    if (mesh.isInstancedMesh) {
      assert.ok(mesh.count > 0);
      assert.equal(mesh.count, again.count);
      assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
      assert.deepEqual(mesh.instanceMatrix.array, again.instanceMatrix.array);
      if (mesh.instanceColor) assert.deepEqual(mesh.instanceColor.array, again.instanceColor.array);
      for (let j = 0; j < mesh.count; j++) {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(j, matrix);
        assert.ok(matrix.determinant() > 0);
      }
    } else {
      assert.deepEqual(geometry.attributes.position.array, again.geometry.attributes.position.array);
    }
  }
  const positions = first.children[1].geometry.attributes.position;
  const firstStem = new THREE.Matrix4(); first.children[1].getMatrixAt(0, firstStem);
  const a = new THREE.Vector3().fromBufferAttribute(positions, 0).applyMatrix4(firstStem);
  const b = new THREE.Vector3().fromBufferAttribute(positions, 1).applyMatrix4(firstStem);
  const c = new THREE.Vector3().fromBufferAttribute(positions, 2).applyMatrix4(firstStem);
  assert.ok(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() > 0.00001);
  assert.equal(first.children[0].geometry.attributes.uv.count, first.children[0].geometry.attributes.position.count);
  assert.equal(first.children[2].geometry, first.children[0].geometry);
  assert.equal(first.children[2].count, first.children[0].count);
  assert.ok(first.children[0].count <= 570, 'per-patch leaf count remains bounded');
});

test('visibility changes are reported for shadow invalidation, including empty ivy', () => {
  const ivy = makeIvy(), camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 20, 30);
  assert.equal(ivy.userData.update(camera), false);
  camera.position.set(230, 20, 30);
  assert.equal(ivy.userData.update(camera), true);
  assert.equal(ivy.children[0].visible, true);
  assert.equal(ivy.children[2].visible, false);
  camera.position.set(1000, 20, 30);
  assert.equal(ivy.userData.update(camera), true);
  assert.ok(ivy.children.every(mesh => !mesh.visible));
  assert.equal(ivy.userData.update(camera), false);
  camera.position.set(10, 20, 30);
  assert.equal(ivy.userData.update(camera), true);
  assert.ok(ivy.children.every(mesh => mesh.visible));
  const empty = createIvy([], () => {}, () => 0.5);
  assert.equal(empty.children.length, 0);
  assert.equal(empty.userData.update(camera), false);
});
