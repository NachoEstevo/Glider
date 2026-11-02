import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Raycaster, Vector3 } from 'three';
import { createGlider, CASTER_LAYER } from '../src/glider/gliderModel.js';

// The model builds its paint in a canvas; these tests exercise geometry and animation only.
function mockCanvas() {
  const noop = () => {};
  const pixels = new Uint8ClampedArray(2048 * 2048 * 4);
  globalThis.ImageData = class {
    constructor(width, height) { this.data = new Uint8ClampedArray(width * height * 4); }
  };
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0 };
      const context = new Proxy({
        canvas,
        getImageData: () => ({ data: pixels }),
        createRadialGradient: () => ({ addColorStop: noop }),
      }, { get: (target, key) => key in target ? target[key] : noop });
      canvas.getContext = () => context;
      return canvas;
    },
    createElementNS: () => ({ addEventListener: noop, removeEventListener: noop }),
  };
}

function meshes(root) {
  const result = [];
  root.traverse((object) => { if (object.isMesh) result.push(object); });
  return result;
}

function geometryTotals(items) {
  return items.reduce((total, { geometry, isInstancedMesh, count }) => {
    const instances = isInstancedMesh ? count : 1;
    total.vertices += geometry.attributes.position.count * instances;
    total.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * instances;
    return total;
  }, { vertices: 0, triangles: 0 });
}

function instancePoint(mesh, index, point) {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  assert.ok(matrix.elements.every(Number.isFinite));
  return point.clone().applyMatrix4(matrix);
}

const radialDistance = (point) => Math.hypot(point.x, point.y);

test('refined engines are opt-in, bounded and keep rotor and stator motion separate', () => {
  const savedDocument = globalThis.document, savedImageData = globalThis.ImageData;
  mockCanvas();
  try {
    const current = createGlider();
    const refined = createGlider({ detail: 'refined' });
    const currentMeshes = meshes(current.root), refinedMeshes = meshes(refined.root);
    assert.equal(currentMeshes.length, 42);
    assert.deepEqual(geometryTotals(currentMeshes), { vertices: 14659, triangles: 23000 });
    assert.equal(currentMeshes.filter((mesh) => mesh.name.startsWith('refined-')).length, 0);
    assert.ok(refinedMeshes.length <= 44);
    const totals = geometryTotals(refinedMeshes);
    assert.ok(totals.vertices < 18000 && totals.triangles < 28000);

    const originalCanopy = currentMeshes.find((mesh) => mesh.geometry.type === 'LatheGeometry' && mesh.scale.x === 0.68);
    assert.ok(originalCanopy);
    assert.equal(originalCanopy.geometry.attributes.position.count, 328);
    assert.equal(originalCanopy.material.transparent, false);
    assert.equal(originalCanopy.material.clearcoat, 1);

    const rotors = refinedMeshes.filter((mesh) => mesh.name === 'refined-rotor');
    const stators = refinedMeshes.filter((mesh) => mesh.name === 'refined-stator');
    const joints = refinedMeshes.filter((mesh) => mesh.name === 'refined-cowl-joints');
    const plumes = refinedMeshes.filter((mesh) => mesh.material.isShaderMaterial && mesh.material.transparent);
    assert.equal(rotors.length, 2);
    assert.equal(stators.length, 2);
    assert.equal(joints.length, 2);
    assert.equal(plumes.length, 2);
    for (const part of [...rotors, ...stators, ...joints]) {
      for (const attribute of Object.values(part.geometry.attributes)) {
        assert.ok(attribute.array.every(Number.isFinite), `${part.name} attributes must be finite`);
      }
      const position = part.geometry.attributes.position;
      assert.ok(part.geometry.index.array.every((index) => index < position.count));
    }
    for (const rotor of rotors) {
      const stator = stators.find((part) => part.parent === rotor.parent.parent);
      assert.ok(stator && stator.position.z < rotor.parent.position.z, 'stator sits behind the rotor');
      assert.equal(stator.layers.isEnabled(CASTER_LAYER), false);
    }
    // A front-facing ray sample checks that the rotor does not cover the entire fixed stage.
    refined.root.updateMatrixWorld(true);
    const stator = stators[0], rotor = rotors.find((part) => part.parent.parent === stator.parent);
    const ray = new Raycaster(), hits = { rotor: 0, stator: 0 };
    for (const radius of [0.3, 0.4, 0.5]) for (let i = 0; i < 72; i++) {
      const angle = i * Math.PI * 2 / 72;
      const origin = stator.parent.localToWorld(new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 5));
      ray.set(origin, new Vector3(0, 0, -1));
      const first = ray.intersectObjects([rotor, stator])[0]?.object;
      if (first === rotor) hits.rotor++;
      if (first === stator) hits.stator++;
    }
    assert.ok(hits.rotor > 20 && hits.stator > 5, 'both stages should be exposed at rest');
    const initialRotorGeometry = rotors.map((rotor) => rotor.geometry);
    refined.update(0.1, 0.5, undefined, 1);
    for (const rotor of rotors) assert.ok(rotor.parent.rotation.z > 0);
    for (const stator of stators) assert.equal(stator.rotation.z, 0);
    for (const plume of plumes) {
      assert.equal(plume.visible, true);
      assert.ok(plume.material.uniforms.uHeat.value > 0);
    }
    const stoppedAngles = rotors.map((rotor) => rotor.parent.rotation.z);
    refined.update(0.2, 0.5, undefined, 0);
    assert.deepEqual(rotors.map((rotor) => rotor.parent.rotation.z), stoppedAngles);
    assert.deepEqual(rotors.map((rotor) => rotor.geometry), initialRotorGeometry);
    for (const plume of plumes) {
      assert.equal(plume.visible, false);
      assert.equal(plume.material.uniforms.uHeat.value, 0);
    }

    // The default version retains its original rotor and engine-off behavior.
    const currentFans = [...new Set(currentMeshes.filter((mesh) => mesh.parent.position.z === 1.55).map((mesh) => mesh.parent))];
    const currentPlumes = currentMeshes.filter((mesh) => mesh.material.isShaderMaterial && mesh.material.transparent);
    assert.equal(currentFans.length, 2);
    current.update(0.1, 0.5, undefined, 1);
    for (const fan of currentFans) assert.equal(fan.rotation.z, 0.1 * (9 + 45 * 0.5));
    current.update(0.2, 0.5, undefined, 0);
    for (const fan of currentFans) assert.equal(fan.rotation.z, 0.1 * (9 + 45 * 0.5));
    for (const plume of currentPlumes) assert.equal(plume.visible, false);
  } finally {
    globalThis.document = savedDocument;
    globalThis.ImageData = savedImageData;
  }
});

test('refined canopy keeps the silhouette and exposes an inset cockpit beneath a single reflective shell', () => {
  const savedDocument = globalThis.document, savedImageData = globalThis.ImageData;
  mockCanvas();
  try {
    const glider = createGlider({ detail: 'refined' });
    glider.root.updateMatrixWorld(true);
    const canopy = glider.root.getObjectByName('refined-canopy');
    const interior = glider.root.getObjectByName('refined-cockpit-interior');
    const seal = glider.root.getObjectByName('refined-canopy-seal');
    const frames = glider.root.getObjectByName('refined-canopy-frames');
    for (const part of [canopy, interior, seal, frames]) {
      assert.ok(part?.isMesh);
      for (const attribute of Object.values(part.geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite));
      assert.ok(part.geometry.index.array.every((index) => index < part.geometry.attributes.position.count));
    }
    assert.equal(canopy.material.transparent, true);
    assert.ok(canopy.material.opacity > 0.5 && canopy.material.opacity < 1);
    assert.equal(canopy.material.transmission, 0);
    assert.equal(canopy.material.depthWrite, false);
    const bounds = new Box3().setFromObject(canopy);
    assert.ok(bounds.min.x >= -0.681 && bounds.max.x <= 0.681);
    assert.ok(bounds.min.y >= 1.099 && bounds.max.y <= 1.821);
    assert.ok(bounds.min.z >= 2.499 && bounds.max.z <= 7.851);

    const ray = new Raycaster();
    const fuselage = glider.body.children[2];
    for (const z of [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]) for (const x of [0, 0.15, 0.3]) {
      ray.set(new Vector3(x, 3, z), new Vector3(0, -1, 0));
      const glassHit = ray.intersectObject(canopy)[0], interiorHit = ray.intersectObject(interior)[0];
      const fuselageHit = ray.intersectObject(fuselage)[0];
      assert.ok(glassHit && interiorHit && fuselageHit, `canopy and cockpit are visible at ${x}, ${z}`);
      assert.ok(glassHit.point.y > interiorHit.point.y && interiorHit.point.y > fuselageHit.point.y,
        `glass, cockpit and fuselage have the correct depth order at ${x}, ${z}`);
    }
  } finally {
    globalThis.document = savedDocument;
    globalThis.ImageData = savedImageData;
  }
});

test('refined nozzle plates pivot together and actuator rods follow a bounded, smooth opening', () => {
  const savedDocument = globalThis.document, savedImageData = globalThis.ImageData;
  mockCanvas();
  try {
    const glider = createGlider({ detail: 'refined' });
    const all = meshes(glider.root);
    const nozzles = all.filter((part) => part.name === 'refined-nozzle-petals');
    const rods = all.filter((part) => part.name === 'refined-nozzle-actuators');
    assert.equal(nozzles.length, 2);
    assert.equal(rods.length, 2);
    const hinge = new Vector3(), tip = new Vector3(0, 0, -0.62), rodEnd = new Vector3(0, 0.5, 0);
    const rodStart = new Vector3(0, -0.5, 0), attachment = new Vector3(0, 0.025, -0.62 * 0.7);
    const states = nozzles.map((petals) => {
      assert.equal(petals.isInstancedMesh, true);
      assert.equal(petals.count, 16);
      assert.equal(petals.layers.isEnabled(CASTER_LAYER), false);
      const actuator = rods.find((part) => part.parent === petals.parent);
      assert.ok(actuator && actuator.isInstancedMesh);
      assert.equal(actuator.count, 8);
      assert.equal(actuator.layers.isEnabled(CASTER_LAYER), false);
      return { petals, actuator, hinges: [], tips: [], bases: [] };
    });
    for (const state of states) for (let i = 0; i < 16; i++) {
      state.hinges.push(instancePoint(state.petals, i, hinge));
      state.tips.push(instancePoint(state.petals, i, tip));
      if (i % 2 === 0) {
        state.bases.push(instancePoint(state.actuator, i / 2, rodStart));
        assert.ok(instancePoint(state.actuator, i / 2, rodEnd).distanceTo(instancePoint(state.petals, i, attachment)) < 1e-6);
      }
    }
    const closedRadius = radialDistance(states[0].tips[0]);
    glider.update(0, 1, undefined, 1);
    assert.ok(instancePoint(states[0].petals, 0, tip).distanceTo(states[0].tips[0]) < 1e-7, 'zero dt does not move the petals');
    glider.update(0.1, 1, undefined, 1);
    const firstRadius = radialDistance(instancePoint(states[0].petals, 0, tip));
    assert.ok(firstRadius > closedRadius && firstRadius < closedRadius + 0.04, 'the first response is gradual');
    glider.update(10, 1, undefined, 1);
    const openRadius = radialDistance(instancePoint(states[0].petals, 0, tip));
    assert.ok(openRadius - closedRadius > 0.06 && openRadius - closedRadius < 0.13);
    for (const state of states) for (let i = 0; i < 16; i++) {
      assert.ok(instancePoint(state.petals, i, hinge).distanceTo(state.hinges[i]) < 1e-7, 'each hinge stays fixed');
      assert.ok(radialDistance(instancePoint(state.petals, i, tip)) > radialDistance(state.tips[i]) + 0.06);
      if (i % 2 === 0) {
        assert.ok(instancePoint(state.actuator, i / 2, rodStart).distanceTo(state.bases[i / 2]) < 1e-6);
        assert.ok(instancePoint(state.actuator, i / 2, rodEnd).distanceTo(instancePoint(state.petals, i, attachment)) < 1e-6);
      }
    }
    glider.update(0.25, 1, undefined, 0);
    const shuttingRadius = radialDistance(instancePoint(states[0].petals, 0, tip));
    assert.ok(shuttingRadius < openRadius && shuttingRadius > closedRadius, 'power loss does not snap the plates shut');
    glider.update(10, 1, undefined, 0);
    assert.ok(Math.abs(radialDistance(instancePoint(states[0].petals, 0, tip)) - closedRadius) < 1e-6);

    // Exponential smoothing remains consistent when the same elapsed time is subdivided.
    glider.update(0.5, 1, undefined, 1);
    const singleStep = instancePoint(states[0].petals, 0, tip);
    glider.update(20, 0, undefined, 1);
    for (let i = 0; i < 5; i++) glider.update(0.1, 1, undefined, 1);
    assert.ok(instancePoint(states[0].petals, 0, tip).distanceTo(singleStep) < 1e-6);
    glider.update(20, 5, undefined, 5);
    assert.ok(radialDistance(instancePoint(states[0].petals, 0, tip)) <= openRadius + 1e-6, 'input is clamped');
  } finally {
    globalThis.document = savedDocument;
    globalThis.ImageData = savedImageData;
  }
});
