import test from 'node:test';
import assert from 'node:assert/strict';
import { crownGeometry, trunkGeometry } from '../src/world/treeGeometry.js';
import { planRuins, ruinFrame } from '../src/world/ruins.js';
import { Builder, buildRuinMeshes } from '../src/world/ruinGeometry.js';

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

test('exposed skeleton wall shards have inward thickness and closed, correctly wound edges', async () => {
  const THREE = await import('three');
  const item = { x: 0, z: 0, y: 0, w: 20, d: 16, h: 24, yaw: 0, lean: 0, leanDir: 0, arch: 'skeleton', seed: 10 };
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const [mesh] = buildRuinMeshes([item], material, ruinFrame, () => 0);
  const g = mesh.geometry, info = g.attributes.aInfo, pos = g.attributes.position, normal = g.attributes.normal;
  let start = -1;
  for (let i = 0; i + 24 <= info.count; i += 4) {
    if (info.getW(i) !== 1 || normal.getX(i) !== 1 || normal.getX(i + 4) !== -1 || normal.getY(i + 8) !== 1 || normal.getY(i + 12) !== -1) continue;
    const b = new THREE.Box3();
    for (let j = i; j < i + 24; j++) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, j));
    const size = b.getSize(new THREE.Vector3());
    if (Math.min(size.x, size.z) >= 0.4 && Math.min(size.x, size.z) <= 0.651 && Math.max(size.x, size.z) > 2 && (Math.abs(b.min.x + 10) < 1e-5 || Math.abs(b.max.x - 10) < 1e-5 || Math.abs(b.min.z + 8) < 1e-5 || Math.abs(b.max.z - 8) < 1e-5)) { start = i; break; }
  }
  assert.ok(start >= 0, 'fixture contains an exposed facade shard');
  const shard = new THREE.BufferGeometry();
  const vertices = [];
  for (let i = start; i < start + 24; i++) vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  shard.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const indices = [];
  for (let i = 0; i < 24; i += 4) indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  shard.setIndex(indices);
  for (let i = start; i < start + 24; i += 4) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1), c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().fromBufferAttribute(normal, i);
    assert.ok(b.sub(a).cross(c.sub(a)).dot(n) > 0, 'each face has outward winding');
  }
  shard.computeBoundingBox();
  const box = shard.boundingBox, size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const axis = size.x < size.z ? 'x' : 'z', thickness = size[axis];
  assert.ok(thickness >= 0.4 && thickness <= 0.65 + 1e-5);
  assert.ok(box.min.x >= -item.w / 2 && box.max.x <= item.w / 2 && box.min.z >= -item.d / 2 && box.max.z <= item.d / 2);
  const isolated = new THREE.Mesh(shard, material), origin = center.clone(), direction = new THREE.Vector3();
  origin[axis] = box.max[axis] + 1; direction[axis] = -1;
  let hit = new THREE.Raycaster(origin, direction).intersectObject(isolated)[0];
  assert.ok(hit && Math.abs(hit.point[axis] - box.max[axis]) < 1e-5);
  origin[axis] = box.min[axis] - 1; direction[axis] = 1;
  hit = new THREE.Raycaster(origin, direction).intersectObject(isolated)[0];
  assert.ok(hit && Math.abs(hit.point[axis] - box.min[axis]) < 1e-5, 'opposite face is visible from the interior');
  origin.copy(center); origin.y = box.min.y - 1; direction.set(0, 1, 0);
  assert.ok(new THREE.Raycaster(origin, direction).intersectObject(isolated).length, 'underside is capped');
  shard.dispose(); g.dispose(); material.dispose();
});

test('destroyed facade openings are traversable and surviving panes are real geometry', async () => {
  const THREE = await import('three');
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  let foundOpening = false, foundPane = false, foundJamb = false;
  for (let seed = 1; seed <= 30 && !(foundOpening && foundPane && foundJamb); seed++) {
    const item = { x: 0, z: 0, y: 0, w: 20, d: 16, h: 24, yaw: 0, lean: 0, leanDir: 0, arch: 'skeleton', seed };
    const [mesh] = buildRuinMeshes([item], material, ruinFrame, () => 0);
    const info = mesh.geometry.attributes.aInfo;
    for (const [axis, edge] of [['x', -10], ['x', 10], ['z', -8], ['z', 8]]) {
      const along = axis === 'x' ? 'z' : 'x', limit = axis === 'x' ? 8 : 10;
      for (let cell = -3; cell < 3; cell++) for (let floor = 1; floor < 6; floor++) {
        const centre = (cell + 0.5) * 3.6;
        if (Math.abs(centre) + 1.1 > limit) continue;
        const cast = offset => {
          const origin = new THREE.Vector3(), direction = new THREE.Vector3();
          origin[axis] = edge + Math.sign(edge); origin[along] = centre + offset; origin.y = (floor + 0.56) * 3.6;
          direction[axis] = -Math.sign(edge);
          return new THREE.Raycaster(origin, direction, 0, 1.7).intersectObject(mesh);
        };
        const middle = cast(0), jamb = cast(1.1);
        if (middle.some(hit => info.getW(hit.face.a) === 5)) foundPane = true;
        if (!middle.length && jamb.some(hit => info.getW(hit.face.a) === 1)) foundOpening = true;
        if (jamb.some(hit => info.getW(hit.face.a) === 1)) foundJamb = true;
      }
    }
    mesh.geometry.dispose();
  }
  assert.ok(foundOpening, 'an empty opening passes the ray while the adjacent jamb blocks it');
  assert.ok(foundJamb, 'concrete around openings has real depth');
  assert.ok(foundPane, 'some surviving panes intercept rays as glass geometry');
  material.dispose();
});

test('each retained skeleton wall is anchored to an emitted perimeter column reaching its top', () => {
  const original = Builder.prototype.box;
  let tested = 0, skippedColumnFixture = false;
  try {
    for (let seed = 1; seed <= 30; seed++) {
      const calls = [];
      Builder.prototype.box = function (...args) { calls.push(args); return original.apply(this, args); };
      const item = { x: 0, z: 0, y: 0, w: 20, d: 16, h: 24, yaw: 0, lean: 0, leanDir: 0, arch: 'skeleton', seed };
      const [mesh] = buildRuinMeshes([item], null, ruinFrame, () => 0);
      mesh.geometry.dispose();
      const columns = calls.filter(([x0, y0, z0, x1, y1, z1, kind]) => kind === 1 && y0 === 0 && y1 > 1 && Math.abs(x1 - x0 - 0.64) < 1e-6 && Math.abs(z1 - z0 - 0.64) < 1e-6);
      if (columns.length < 12) skippedColumnFixture = true; // 4 x 3 grid
      const sides = new Map();
      for (const [x0, y0, z0, x1, y1, z1, kind, options] of calls) {
        if (kind !== 1 || !options?.bottom) continue;
        const side = x1 - x0 < z1 - z0
          ? (Math.abs(x0 + 10) < 1e-6 ? 'left' : Math.abs(x1 - 10) < 1e-6 ? 'right' : null)
          : (Math.abs(z0 + 8) < 1e-6 ? 'back' : Math.abs(z1 - 8) < 1e-6 ? 'front' : null);
        if (!side) continue;
        if (!sides.has(side)) sides.set(side, []);
        sides.get(side).push({ x0, y0, z0, x1, y1, z1 });
      }
      for (const [side, parts] of sides) {
        const xSide = side === 'left' || side === 'right';
        const min = Math.min(...parts.map(p => xSide ? p.z0 : p.x0));
        const max = Math.max(...parts.map(p => xSide ? p.z1 : p.x1));
        const top = Math.max(...parts.map(p => p.y1));
        assert.ok(columns.some(([x0, , z0, x1, y1, z1]) => {
          const along = xSide ? (z0 + z1) / 2 : (x0 + x1) / 2;
          const cross = xSide ? (x0 + x1) / 2 : (z0 + z1) / 2;
          const expected = side === 'left' ? -9.5 : side === 'right' ? 9.5 : side === 'back' ? -7.5 : 7.5;
          return Math.abs(cross - expected) < 1e-6 && y1 >= top && (Math.abs(along - min) < 1e-6 || Math.abs(along - max) < 1e-6);
        }), `wall on ${side} must meet a real supporting column`);
        tested++;
      }
    }
  } finally { Builder.prototype.box = original; }
  assert.ok(skippedColumnFixture && tested > 0, 'exercise retained walls with missing grid columns');
});
