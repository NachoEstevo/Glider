import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/glider/cameraRig.js';

const setup = (aspect = 1.6) => {
  const camera = new THREE.PerspectiveCamera(55, aspect, .1, 1000);
  const rig = new CameraRig(camera);
  const flight = {pos: new THREE.Vector3(0, 30, 0), heading: 0, bank: 0};
  rig.snap(flight);
  return {camera, rig, flight};
};
const finite = rig => [rig.yaw, ...rig.pos.toArray(), ...rig.look.toArray(), ...rig.up.toArray(), ...rig.camera.quaternion.toArray()].every(Number.isFinite);

test('return from orbit enters overhead over 2.8 seconds without angular jumps', () => {
  const {rig, flight} = setup();
  rig.cycle(); rig.update(flight, 3);
  rig.cycle(); rig.orbitAngle = 2.3; rig.update(flight, 3);
  rig.cycle();
  const initial = rig.pos.clone();
  const initialUp = rig.up.clone();
  const initialYaw = rig.yaw;
  rig.update(flight, .05);
  assert.ok(rig.pos.distanceTo(initial) < .5);
  assert.ok(rig.up.angleTo(initialUp) < .02);
  assert.ok(Math.abs(rig.yaw - initialYaw) < .02);
  for (let i = 0; i < 27; i++) { flight.pos.z += 2; rig.update(flight, .05); assert.ok(finite(rig)); }
  assert.ok(rig.overheadTransition);
  for (let i = 0; i < 29; i++) { flight.pos.z += 2; rig.update(flight, .05); assert.ok(finite(rig)); }
  assert.equal(rig.overheadTransition, null);
  assert.ok(rig.pos.y > flight.pos.y + 50);
});

test('rapid changes, portrait framing and snap remain finite and immediate', () => {
  const {rig, flight} = setup(.55);
  rig.zoom = 2.2;
  for (let i = 0; i < 40; i++) {
    rig.cycle(); flight.heading += .2; flight.pos.x += 1; rig.update(flight, .03);
    assert.ok(finite(rig));
    assert.ok(rig.pos.y >= 6);
  }
  rig.mode = 'overhead';
  rig.snap(flight);
  assert.equal(rig.overheadTransition, null);
  assert.ok(rig.pos.y > flight.pos.y + 200);
  assert.ok(finite(rig));
});
