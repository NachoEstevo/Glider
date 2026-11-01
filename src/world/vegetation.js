import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { worldHeight, WORLD_SIZE } from './worldHeight.js';
import { ruinFrame } from './ruins.js';
import { createIvy } from './ivy.js';
import { crownGeometry, trunkGeometry } from './treeGeometry.js';
import { partitionVegetation, updateVegetationDistance } from './vegetationBatches.js';

// Grass uses the foliage atlas (tools/compose_foliage.py, ambientCG CC0).
const REGION = { grass: [0.5, 0, 1, 0.5] };

function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// quads as one geometry; each card: centre, right and up vectors, normal (bent for soft
// volume lighting), atlas region, flip
function cards(list, region) {
  const [u0, v0, u1, v1] = region;
  const pos = [], nrm = [], uv = [], idx = [];
  for (const c of list) {
    const b = pos.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [sx, sy] of corners) {
      pos.push(c.o.x + c.r.x * sx + c.u.x * sy, c.o.y + c.r.y * sx + c.u.y * sy, c.o.z + c.r.z * sx + c.u.z * sy);
      const n = c.n(sx, sy);
      nrm.push(n.x, n.y, n.z);
      const fx = c.flip ? -sx : sx;
      uv.push(u0 + (u1 - u0) * (fx * 0.5 + 0.5), v0 + (v1 - v0) * (sy * 0.5 + 0.5));
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// three crossed blades standing on y = 0
function tuftGeometry() {
  const list = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const r = new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    list.push({ o: new THREE.Vector3(0, 0.5, 0), r, u: new THREE.Vector3(0, 0.5, 0), flip: k === 1, n: (sx, sy) => new THREE.Vector3(sx * 0.3, 1, 0).normalize() });
  }
  return cards(list, REGION.grass);
}

// --- tropical plants from the Poly Haven leaf textures (tools/compose_plants.py) ---------
// plants_atlas.png cells (u, v from the bottom)
const PLANT = {
  fern: [[0, 0, 0.25, 1], [0.75, 0, 1, 1]],
  pachira: [[0.25, 0.5, 0.5, 1], [0.25, 0, 0.5, 0.5]],
  calathea: [[0.5, 0.5, 0.75, 1], [0.5, 0, 0.75, 0.5]],
};

// bent leaf strips: each from its base o along the horizontal dir, rising then drooping
// (P(t) = o + dir L t + up L (rise t - droop t^2)), width w, the cell's v running up the leaf
function bentLeaves(list) {
  const pos = [], nrm = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const f of list) {
    const [u0, v0, u1, v1] = f.region, S = f.segs ?? 4;
    const side = new THREE.Vector3().crossVectors(up, f.dir).normalize();
    const P = (t) => f.o.clone().addScaledVector(f.dir, f.L * t).addScaledVector(up, f.L * (f.rise * t - f.droop * t * t));
    const b = pos.length / 3;
    for (let i = 0; i <= S; i++) {
      const t = i / S, p = P(t), tan = P(Math.min(1, t + 0.01)).sub(P(Math.max(0, t - 0.01))).normalize();
      const n = new THREE.Vector3().crossVectors(side, tan).normalize();
      if (n.y < 0) n.negate();
      n.y += 0.4; n.normalize();
      for (const s of [-1, 1]) {
        const q = p.clone().addScaledVector(side, s * f.w / 2);
        pos.push(q.x, q.y, q.z);
        nrm.push(n.x, n.y, n.z);
        uv.push(s < 0 ? u0 : u1, v0 + (v1 - v0) * t);
      }
    }
    for (let i = 0; i < S; i++) { const a = b + i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// a fern clump, ~1 m: a dozen fronds arching out of one crown
function fernGeometry(rand) {
  const list = [];
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * Math.PI * 2 + rand() * 0.4;
    list.push({ o: new THREE.Vector3(0, 0, 0), dir: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), L: 0.75 + rand() * 0.4, w: 0.36,
      rise: 1.1 + rand() * 0.6, droop: 0.9 + rand() * 0.5, region: PLANT.fern[i % 2] });
  }
  return bentLeaves(list);
}

// calathea: broad leaves on long stalks, fanning up from the ground, ~1 m
function calatheaGeometry(rand) {
  const list = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand() * 0.5, d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const stalk = 0.35 + rand() * 0.35;
    list.push({ o: d.clone().multiplyScalar(0.12 * stalk).setY(stalk), dir: d, L: 0.55, w: 0.48, rise: 0.9 + rand() * 0.6, droop: 0.6 + rand() * 0.4, segs: 3, region: PLANT.calathea[i % 2] });
  }
  return bentLeaves(list);
}

// pachira crown, unit size like crownGeometry: palmate leaves held flat-ish, facing the sky,
// in a domed layer (the canopy of a tropical tree seen from above)
function pachiraCrownGeometry(rand) {
  const list = [];
  for (let i = 0; i < 120; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.85;
    const o = new THREE.Vector3(Math.cos(a) * r, 0.35 * (1 - r * r) + (rand() - 0.5) * 0.25, Math.sin(a) * r);
    const facing = new THREE.Vector3((rand() - 0.5) * 0.8 + o.x * 0.6, 1, (rand() - 0.5) * 0.8 + o.z * 0.6).normalize();
    const rr = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
    rr.sub(facing.clone().multiplyScalar(rr.dot(facing))).normalize();
    const u = facing.clone().cross(rr).normalize();
    const s = 0.12 + rand() * 0.07;
    rr.multiplyScalar(s); u.multiplyScalar(s);
    list.push({ o, r: rr, u, flip: rand() < 0.5, n: () => facing.clone().add(o.clone().multiplyScalar(0.6)).normalize() });
  }
  return [cards(list.filter((_, i) => i % 2 === 0), PLANT.pachira[0]), cards(list.filter((_, i) => i % 2 === 1), PLANT.pachira[1])];
}

// a coconut palm, 1 m tall in its own units (scaled per instance): a curving ringed trunk
// is separate; this is the head: ~11 arching fronds of leaflet pairs, a few dead ones
// hanging brown underneath. Vertex colours: dark at the rachis, sunlit yellow-green tips.
function palmHeadGeometry(rand) {
  const pos = [], col = [], nrm = [];
  const green = new THREE.Color(0.22, 0.42, 0.1), tip = new THREE.Color(0.62, 0.7, 0.24), dead = new THREE.Color(0.42, 0.31, 0.16);
  const tri = (a, b, c, ca, cb, cc) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.y < 0) n.negate();
    n.y += 0.6; n.normalize();   // soft, crown-like shading
    for (const [v, k] of [[a, ca], [b, cb], [c, cc]]) { pos.push(v.x, v.y, v.z); nrm.push(n.x, n.y, n.z); col.push(k.r, k.g, k.b); }
  };
  const N = 14;
  for (let f = 0; f < N; f++) {
    const isDead = f >= 11;
    const a = (f / 11) * Math.PI * 2 + rand() * 0.4, L = (isDead ? 0.32 : 0.42 + rand() * 0.12);
    const rise = isDead ? -0.6 : 0.55 - rand() * 0.25, droop = isDead ? 0.4 : 1.1 + rand() * 0.5;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const P = (t) => dir.clone().multiplyScalar(L * t).add(new THREE.Vector3(0, L * (rise * t - droop * t * t), 0));
    const S = 12;
    for (let i = 0; i < S; i++) {
      const t0 = i / S, t1 = (i + 1) / S, p0 = P(t0 + 0.04), p1 = P(t1);
      const len = L * 0.38 * Math.sin(Math.PI * Math.min(1, (t0 + 0.15) / 1.05));
      for (const sg of [-1, 1]) {
        const tipP = p1.clone().addScaledVector(side, sg * len).add(new THREE.Vector3(0, -len * 0.45, 0)).addScaledVector(dir, len * 0.3);
        const cBase = isDead ? dead : green, cTip = isDead ? dead.clone().multiplyScalar(0.8) : tip.clone().lerp(green, t0 * 0.4);
        tri(p0, p1, tipP, cBase, cBase, cTip);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// palm trunk of a 10 m palm, in metres: slender, curving out (x) by PALM_LEAN, swollen at
// the base; the head sits at (PALM_LEAN, 10, 0)
const PALM_LEAN = 1.4;
function palmTrunkGeometry() {
  const g = new THREE.CylinderGeometry(0.15, 0.22, 10, 8, 10).translate(0, 5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), u = y / 10, k = 1 + 0.6 * Math.max(0, 0.08 - u) / 0.08;
    p.setXYZ(i, p.getX(i) * k + PALM_LEAN * u * u, y, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

// --- materials --------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
function tex(file, srgb, repeat) {
  const t = loader.load(`/textures/${file}`);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

// sway: GLSL weight (0 = rooted) from the local position; leaves get a soft back light
function foliageMaterial(atlas, patchCustom, key, sway) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, envMapIntensity: 0.6 });
  patchCustom(m, {}, {
    key: '-leaf-' + key,
    vertPars: 'uniform float uTime;\n',
    vertPre: /* glsl */`
  {
    vec3 io = vec3(0.0);
  #ifdef USE_INSTANCING
    io = instanceMatrix[3].xyz;
  #endif
    float w = ${sway};
    float t = uTime * 1.3 + io.x * 0.11 + io.z * 0.07;
    transformed.x += (sin(t) + 0.4 * sin(t * 2.7 + position.y * 3.0)) * 0.04 * w;
    transformed.z += (cos(t * 0.8) + 0.4 * sin(t * 3.1 + position.x * 3.0)) * 0.04 * w;
  }`,
    // a touch of light through the leaves on the shadow side
    albedo: 'diffuseColor.rgb *= 1.08;',
  });
  m.shadowSide = THREE.DoubleSide;
  return m;
}

// --- placement --------------------------------------------------------------------------
function islandSpots(rand, count, minH, spread, perClump) {
  const spots = [];
  const eps = 3;
  for (let i = 0; i < count * 60 && spots.length < count; i++) {
    const x = (rand() - 0.5) * WORLD_SIZE * 0.85, z = (rand() - 0.5) * WORLD_SIZE * 0.85;
    const h = worldHeight(x, z);
    if (h < minH) continue;
    const slope = Math.hypot(worldHeight(x + eps, z) - h, worldHeight(x, z + eps) - h) / eps;
    if (slope > 0.9) continue;
    const n = perClump[0] + Math.floor(rand() * (perClump[1] - perClump[0]));
    for (let k = 0; k < n && spots.length < count; k++) {
      const ox = x + (rand() - 0.5) * spread, oz = z + (rand() - 0.5) * spread;
      const oh = worldHeight(ox, oz);
      if (oh < minH - 0.4) continue;
      spots.push({ x: ox, z: oz, y: oh, s: 2.2 + Math.pow(rand(), 1.5) * 4.5 });
    }
  }
  return spots;
}

const LEAF_TINTS = [[0.62, 0.78, 0.5], [0.5, 0.68, 0.42], [0.72, 0.82, 0.52], [0.55, 0.7, 0.36], [0.8, 0.8, 0.5]].map((c) => new THREE.Color(...c));

export function createVegetation(patchCustom, ruinPlan, count = 12000) {
  const rand = rng(99);
  const group = new THREE.Group();
  const atlas = tex('foliage_atlas.png', true);
  const leafMat = foliageMaterial(atlas, patchCustom, 'crown', 'clamp(position.y + 0.8, 0.0, 1.6)');
  const grassMat = foliageMaterial(atlas, patchCustom, 'grass', 'position.y * 1.5');
  const barkMat = new THREE.MeshStandardMaterial({ map: tex('bark_color.jpg', true, [2, 3]), normalMap: tex('bark_n.png', false, [2, 3]), roughness: 0.9, metalness: 0 });
  patchCustom(barkMat, {}, { key: '-bark' });

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();

  // --- trees: islands plus the overgrown roofs ---
  const trees = islandSpots(rand, count, 2.6, 14, [3, 8]).concat(ruinPlan.roofSpots);
  // two kinds: clumpy broadleaf crowns and flat-topped tropical (pachira) canopies
  const plantAtlas = tex('plants_atlas.png', true);
  const tropMat = foliageMaterial(plantAtlas, patchCustom, 'tropic', 'clamp(position.y + 0.8, 0.0, 1.6)');
  const kind = trees.map(() => (rand() < 0.4 ? 1 : 0));
  const nTrop = kind.filter((k) => k).length;
  const crowns = new THREE.InstancedMesh(crownGeometry(rand), leafMat, trees.length - nTrop);
  const tropCrowns = new THREE.InstancedMesh(mergeGeometries(pachiraCrownGeometry(rand)), tropMat, nTrop);
  const trunks = new THREE.InstancedMesh(trunkGeometry(), barkMat, trees.length);
  let ib = 0, it2 = 0;
  trees.forEach((t, i) => {
    const trop = kind[i];
    const H = t.s * (trop ? 2.0 + rand() * 0.9 : 1.6 + rand() * 0.8), R = t.s * (trop ? 1.25 + rand() * 0.35 : 0.9 + rand() * 0.3);
    q.setFromEuler(e.set((rand() - 0.5) * 0.15, rand() * 6.28, (rand() - 0.5) * 0.15));
    m.compose(p.set(t.x, t.y - 0.3, t.z), q, s.set(t.s * (trop ? 0.12 : 0.16), H * 0.8, t.s * (trop ? 0.12 : 0.16)));
    trunks.setMatrixAt(i, m);
    m.compose(p.set(t.x, t.y + H * (trop ? 0.78 : 0.72), t.z), q.setFromEuler(e.set(0, rand() * 6.28, 0)), s.set(R, R * (trop ? 0.6 + rand() * 0.2 : 0.75 + rand() * 0.3), R));
    const tint = LEAF_TINTS[Math.floor(rand() * LEAF_TINTS.length)].clone().multiplyScalar(0.85 + rand() * 0.3);
    if (trop) { tropCrowns.setMatrixAt(it2, m); tropCrowns.setColorAt(it2++, tint.lerp(new THREE.Color(1, 1, 1), 0.5)); }
    else { crowns.setMatrixAt(ib, m); crowns.setColorAt(ib++, tint); }
  });

  // --- understory: fern clumps and calathea under the trees, ferns all over the ruined roofs ---
  const ferns = [], cals = [];
  for (const t of trees) {
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const a = rand() * 6.28, d = t.s * (t.onRoof ? 0.15 + rand() * 0.45 : 0.3 + rand() * 1.4), x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      const y = t.onRoof ? t.y : worldHeight(x, z);
      if (!t.onRoof && y < 1.2) continue;
      (rand() < 0.65 || t.onRoof ? ferns : cals).push({ x, z, y, s: 0.9 + rand() * 1.1 });
    }
  }
  const fernMesh = new THREE.InstancedMesh(fernGeometry(rand), tropMat, ferns.length);
  const calMesh = new THREE.InstancedMesh(calatheaGeometry(rand), tropMat, cals.length);
  for (const [mesh, list] of [[fernMesh, ferns], [calMesh, cals]]) {
    list.forEach((f, i) => {
      m.compose(p.set(f.x, f.y - 0.05, f.z), q.setFromEuler(e.set(0, rand() * 6.28, 0)), s.setScalar(f.s * (mesh === calMesh ? 1.2 : 1.4)));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.8 + rand() * 0.35));
    });
  }
  for (const mesh of [tropCrowns, fernMesh, calMesh]) mesh.castShadow = mesh.receiveShadow = true;

  // --- coconut palms along the beaches, leaning out over the sand ---
  const palmSpots = islandSpots(rand, 3200, 0.7, 30, [2, 6]).filter((t) => t.y < 4.5);
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, envMapIntensity: 0.6 });
  patchCustom(palmMat, {}, {
    key: '-palm',
    vertPars: 'uniform float uTime;\n',
    vertPre: /* glsl */`
  {
    vec3 io = vec3(0.0);
  #ifdef USE_INSTANCING
    io = instanceMatrix[3].xyz;
  #endif
    float w = length(position.xz) * 2.0;   // the frond tips move, the heart stays
    float t = uTime * 1.1 + io.x * 0.13 + io.z * 0.09;
    transformed.y += sin(t + w * 2.0) * 0.025 * w;
    transformed.x += (sin(t * 0.7) + 0.5 * sin(t * 2.3 + w * 4.0)) * 0.012 * w;
  }`,
  });
  palmMat.shadowSide = THREE.DoubleSide;
  const palmHeads = new THREE.InstancedMesh(palmHeadGeometry(rand), palmMat, palmSpots.length);
  const palmTrunks = new THREE.InstancedMesh(palmTrunkGeometry(), barkMat, palmSpots.length);
  palmSpots.forEach((t, i) => {
    const k = (7 + rand() * 7) / 10, yaw = rand() * 6.28;
    q.setFromEuler(e.set(0, yaw, 0));
    m.compose(p.set(t.x, t.y - 0.3, t.z), q, s.set(k, k * (0.9 + rand() * 0.2), k));
    palmTrunks.setMatrixAt(i, m);
    // head at the top of the curved trunk (local (PALM_LEAN, 10, 0) turned by yaw)
    const hx = PALM_LEAN * k, hy = 10 * k;
    p.set(t.x + Math.cos(yaw) * hx, t.y - 0.3 + hy * 0.98, t.z - Math.sin(yaw) * hx);
    m.compose(p, q.setFromEuler(e.set((rand() - 0.5) * 0.2, rand() * 6.28, (rand() - 0.5) * 0.2)), s.setScalar(10 * k));
    palmHeads.setMatrixAt(i, m);
    palmHeads.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.85 + rand() * 0.3));
  });
  for (const mesh of [palmHeads, palmTrunks]) mesh.castShadow = mesh.receiveShadow = true;

  // --- grass clumps: island meadows and roofs ---
  const tufts = islandSpots(rand, 20000, 1.4, 22, [4, 10]);
  for (const r of ruinPlan.roofSpots) for (let k = 0; k < 4; k++) tufts.push({ x: r.x + (rand() - 0.5) * r.s * 3, z: r.z + (rand() - 0.5) * r.s * 3, y: r.y, s: 1.5 });
  const grass = new THREE.InstancedMesh(tuftGeometry(), grassMat, tufts.length);
  tufts.forEach((t, i) => {
    const sc = 1.2 + rand() * 1.6;
    m.compose(p.set(t.x, t.y - 0.05, t.z), q.setFromEuler(e.set(0, rand() * 6.28, 0)), s.set(sc * 1.3, sc, sc * 1.3));
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, LEAF_TINTS[Math.floor(rand() * LEAF_TINTS.length)].clone().multiplyScalar(0.8 + rand() * 0.35));
  });

  // --- ivy patches along walls above the water ---
  const curtains = [], edgeFerns = [];
  const bq = new THREE.Quaternion(), bp = new THREE.Vector3();
  const { items } = ruinPlan;
  items.forEach((it, i) => {
    const top = it.y + it.hb;   // hang from the standing walls, not a collapsed skeleton
    if (top < 1.5 || it.arch === 'skeleton') return;
    ruinFrame(items, i, bp, bq);
    // four walls: outward normal in the box frame, wall length, offset to the wall
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (rand() > 0.82) continue;
      const along = nx ? it.d : it.w, half = nx ? it.w / 2 : it.d / 2;
      const n = 1 + Math.floor(rand() * Math.min(5, along / 5));
      for (let k = 0; k < n; k++) {
        const cw = 4 + rand() * Math.min(11, along * 0.6);
        const c = (rand() - 0.5) * Math.max(0, along - cw);
        const ch = Math.min(it.hb + 1, (0.3 + rand() * 0.7) * (top + 2));
        // local placement: on the wall at roof height, facing out
        const lp = new THREE.Vector3(nx ? nx * (half + 0.12 + (it.ledge ? 0.25 : 0)) : c, it.hb + (it.arch === 'intact' ? 0.9 : 0.15), nz ? nz * (half + 0.12 + (it.ledge ? 0.25 : 0)) : c);
        const yaw = Math.atan2(nx, nz);
        const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
        curtains.push({ p: lp.applyQuaternion(bq).add(bp), q: bq.clone().multiply(lq), w: cw, h: ch });   // never mirrored: a negative scale turns the strands inside out
        // the plants the vines come from: fern clumps along the roof edge above them
        for (let f = 0, nf = Math.floor(cw / 3.5); f < nf; f++) {
          if (rand() < 0.35) continue;
          const a = c + (rand() - 0.5) * cw * 0.9, inset = half - 0.3 - rand() * 0.6;
          const fp = new THREE.Vector3(nx ? nx * inset : a, it.hb, nz ? nz * inset : a).applyQuaternion(bq).add(bp);
          edgeFerns.push({ p: fp, s: 0.9 + rand() * 0.9 });
        }
      }
    }
  });
  const ivy = createIvy(curtains, patchCustom, rand);
  group.add(ivy);
  const edgeFernMesh = new THREE.InstancedMesh(fernGeometry(rand), tropMat, edgeFerns.length);
  edgeFerns.forEach((f, i) => {
    m.compose(f.p, q.setFromEuler(e.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3)), s.setScalar(f.s * 1.4));
    edgeFernMesh.setMatrixAt(i, m);
    edgeFernMesh.setColorAt(i, new THREE.Color(1, 1, 1).multiplyScalar(0.75 + rand() * 0.35));
  });
  edgeFernMesh.castShadow = edgeFernMesh.receiveShadow = true;
  for (const mesh of [crowns, trunks, grass]) mesh.castShadow = mesh.receiveShadow = true;
  grass.castShadow = false;
  const groundDetail = [];
  let grassBatches;
  for (const mesh of [crowns, trunks, tropCrowns, fernMesh, calMesh, palmHeads, palmTrunks, grass, edgeFernMesh]) {
    const batches = partitionVegetation(mesh);
    group.add(...batches);
    if (mesh === grass) grassBatches = batches;
    if (mesh === fernMesh || mesh === calMesh || mesh === edgeFernMesh) groundDetail.push(...batches);
  }
  const cameraPosition = new THREE.Vector3();
  group.userData.update = (camera, time) => {
    // These meshes use world-space instance matrices and an identity parent transform.
    camera.getWorldPosition(cameraPosition);
    const groundShadowChanged = updateVegetationDistance(groundDetail, cameraPosition, 400);
    updateVegetationDistance(grassBatches, cameraPosition, 250);
    return ivy.userData.update(camera, time) || groundShadowChanged;
  };
  return group;
}
