import * as THREE from 'three';

// Instances retain world-space matrices so the existing wind shaders keep their phase.
// Independent bounds allow Three.js to cull foliage for both camera and shadow passes.
export function partitionVegetation(mesh, cellSize = 256) {
  if (!(cellSize > 0)) throw new RangeError('cellSize must be positive');
  const cells = new Map();
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    const e = matrix.elements;
    const key = `${Math.floor(e[12] / cellSize)},${Math.floor(e[14] / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  }
  const batches = [];
  for (const indices of cells.values()) {
    const batch = new THREE.InstancedMesh(mesh.geometry, mesh.material, indices.length);
    batch.castShadow = mesh.castShadow;
    batch.receiveShadow = mesh.receiveShadow;
    for (let i = 0; i < indices.length; i++) {
      mesh.getMatrixAt(indices[i], matrix);
      batch.setMatrixAt(i, matrix);
      if (mesh.instanceColor) {
        mesh.getColorAt(indices[i], color);
        batch.setColorAt(i, color);
      }
    }
    batch.computeBoundingSphere();
    // Wind displaces vertices in local coordinates; allow for the largest generated scale.
    batch.boundingSphere.radius += 2;
    batches.push(batch);
  }
  // Only instance buffers belong to the original mesh; geometry and material are shared.
  mesh.dispose();
  return batches;
}

// Toggle only small ground detail beyond its useful viewing distance. The sphere
// radius keeps the nearest part of a cell visible, and hysteresis avoids flicker.
export function updateVegetationDistance(batches, cameraPosition, distance, hysteresis = 40) {
  let shadowChanged = false;
  for (const batch of batches) {
    const sphere = batch.boundingSphere;
    const threshold = distance + sphere.radius + (batch.visible ? hysteresis / 2 : -hysteresis / 2);
    const visible = sphere.center.distanceToSquared(cameraPosition) <= threshold * threshold;
    if (visible !== batch.visible) {
      batch.visible = visible;
      if (batch.castShadow) shadowChanged = true;
    }
  }
  return shadowChanged;
}
