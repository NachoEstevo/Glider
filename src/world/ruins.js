import * as THREE from 'three';
import { CITIES, cityMask, worldHeight } from './worldHeight.js';
import { ruinSurface } from './ruinMaterial.js';
import { buildRuinMeshes } from './ruinGeometry.js';

// The drowned cities: blocks of instanced boxes on a street grid. Most roofs sit a few
// metres under the surface (read through the water from above), some break it, and a
// few towers stand tall, leaning or snapped off.
const BLOCK = 46, STREET = 13;


function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// heights above the street (streets sit ~7.5 m under the surface)
function buildingHeight(rand, mask) {
  const r = rand();
  if (r < 0.5) return 1.5 + rand() * 3.5;                  // roofs well under water
  if (r < 0.8) return 5 + rand() * 1.8;                    // roofs just under the surface
  if (r < 0.93) return 8.5 + rand() * 9;                   // breaking the surface
  return 22 + rand() * 50 * mask;                          // towers
}

// what kind of ruin: see ruinGeometry.js. hb is the height of the standing walls (the roof
// that vegetation and ivy hang from); qf the four block heights of a stepped one.
function archetype(rand, top, w, d, h) {
  const r = rand(), seed = (rand() * 1e9) | 0;
  let arch = 'intact';
  if (r < (top < 1 ? 0.3 : 0.06)) arch = 'skeleton';
  else if (r < 0.4) arch = 'collapsed';
  else if (r < 0.55 && w > 12 && d > 12) arch = 'stepped';
  const qf = [rand(), rand(), rand(), rand()].map((v) => 0.35 + 0.65 * v);
  qf[Math.floor(rand() * 4)] = 1;
  const hb = arch === 'collapsed' ? h * (0.4 + rand() * 0.4) : arch === 'skeleton' ? 0 : arch === 'stepped' ? h * Math.min(...qf) : h;
  return {
    arch, hb, qf, seed,
    ledge: rand() < 0.5 ? (rand() < 0.6 ? 1 : 2) : 0,      // floor bands every 1 or 2 floors
    balc: rand() < 0.35 && h < 34, balcSide: Math.floor(rand() * 4),
  };
}

// Pure data: every box, plus a lookup of the roofs that break the surface (the shore map
// bakes them in so foam and swash wrap around them) and roof spots for vegetation.
export function planRuins() {
  const rand = rng(1337);
  const items = [];
  for (const c of CITIES) {
    const angle = rand() * Math.PI;                        // each city on its own grid
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const n = Math.ceil(c.r / (BLOCK + STREET));
    for (let bi = -n; bi <= n; bi++) for (let bj = -n; bj <= n; bj++) {
      const lx = bi * (BLOCK + STREET), lz = bj * (BLOCK + STREET);
      // three's yaw convention (matches the boxes' rotation.y)
      const cx = c.x + lx * ca + lz * sa, cz = c.z - lx * sa + lz * ca;
      const mask = cityMask(cx, cz);
      if (mask < 0.15 || rand() > 0.35 + mask) continue;
      // split the block into 1..4 lots
      const split = rand() < 0.15 ? 1 : rand() < 0.4 ? 2 : 4;
      const lots = split === 1 ? [[0, 0, 1, 1]] : split === 2 ? [[-0.25, 0, 0.5, 1], [0.25, 0, 0.5, 1]]
        : [[-0.25, -0.25, 0.5, 0.5], [0.25, -0.25, 0.5, 0.5], [-0.25, 0.25, 0.5, 0.5], [0.25, 0.25, 0.5, 0.5]];
      for (const [ox, oz, sx, sz] of lots) {
        if (rand() < 0.18) continue;                       // empty lot / long gone
        const w = BLOCK * sx * (0.55 + rand() * 0.3), d = BLOCK * sz * (0.55 + rand() * 0.3);
        const px = cx + (ox * ca + oz * sa) * BLOCK, pz = cz + (-ox * sa + oz * ca) * BLOCK;
        const base = worldHeight(px, pz) - 1.5;
        let h = buildingHeight(rand, mask);
        const lean = h > 25 && rand() < 0.35 ? (rand() - 0.5) * 0.35 : (rand() - 0.5) * 0.03;
        const it = { x: px, z: pz, y: base, w, d, h, yaw: angle, lean, leanDir: rand() * Math.PI * 2, ...archetype(rand, base + h, w, d, h) };
        items.push(it);
        // setbacks on taller intact buildings
        if (h > 18 && it.arch === 'intact' && rand() < 0.6) {
          const t = 0.55 + rand() * 0.25, hs = h * (0.15 + rand() * 0.35);
          items.push({ x: px, z: pz, y: base + h, w: w * t, d: d * t, h: hs, yaw: angle, lean, leanDir: it.leanDir, onTop: true,
            arch: 'intact', hb: hs, seed: (rand() * 1e9) | 0, ledge: it.ledge, balc: false });
        }
      }
    }
  }

  // the street life it had: cars left in the drowned streets, boats half sunk between blocks
  const props = [];
  CITIES.forEach((c, ci) => {
    const angle = items.find((it) => Math.hypot(it.x - c.x, it.z - c.z) < c.r)?.yaw ?? 0;
    const ca = Math.cos(angle), sa = Math.sin(angle), P = BLOCK + STREET, n = Math.ceil(c.r / P);
    for (let k = 0; k < 70; k++) {
      const alongX = rand() < 0.5, line = (Math.floor(rand() * 2 * n) - n + 0.5) * P, t = (rand() * 2 - 1) * n * P;
      const lane = (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 2.5);
      const lx = alongX ? t : line + lane, lz = alongX ? line + lane : t;
      const x = c.x + lx * ca + lz * sa, z = c.z - lx * sa + lz * ca;
      if (cityMask(x, z) < 0.3) continue;
      props.push({ x, z, y: worldHeight(x, z), w: 1.9, d: 4.4, h: 1.5, yaw: angle + (alongX ? Math.PI / 2 : 0) + (rand() - 0.5) * 0.5,
        lean: (rand() - 0.5) * 0.15, leanDir: rand() * 6.28, arch: 'car', hb: 0, seed: (rand() * 1e9) | 0 });
    }
    for (let k = 0; k < 9 + ci % 4; k++) {
      const a = rand() * 6.28, r = rand() * c.r * 0.8, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const L = 6 + rand() * 7;
      props.push({ x, z, y: -0.9 - rand() * 1.6, w: L * 0.32, d: L, h: 2, yaw: rand() * 6.28, lean: 0.08 + rand() * 0.3, leanDir: rand() * 6.28, arch: 'boat', hb: 0, seed: (rand() * 1e9) | 0 });
    }
  });

  const CELL = 64, grid = new Map(), roofSpots = [];
  const key = (i, j) => i * 100003 + j;
  for (const it of items) {
    const top = it.y + it.h;
    if (it.onTop || top < 0.4 || Math.abs(it.lean) > 0.05) continue;
    const r = Math.hypot(it.w, it.d) / 2;
    for (let i = Math.floor((it.x - r) / CELL); i <= Math.floor((it.x + r) / CELL); i++)
      for (let j = Math.floor((it.z - r) / CELL); j <= Math.floor((it.z + r) / CELL); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(it);
      }
    // overgrown roofs on the buildings that stand clear of the water
    const roof = it.y + it.hb;
    if (roof > 1.2 && (it.arch === 'intact' || it.arch === 'collapsed')) {
      const n = Math.floor(rand() * 7 * Math.min(1.4, it.w * it.d / 500));
      for (let k = 0; k < n; k++) {
        const lx = (rand() - 0.5) * it.w * 0.7, lz = (rand() - 0.5) * it.d * 0.7;
        const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
        roofSpots.push({ x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c, y: roof, s: 1.6 + rand() * 2.6, onRoof: true });
      }
    }
  }
  function topAt(x, z) {
    const cell = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!cell) return -Infinity;
    let best = -Infinity;
    for (const it of cell) {
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw), dx = x - it.x, dz = z - it.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < it.w / 2 && Math.abs(lz) < it.d / 2) best = Math.max(best, it.y + it.h);
    }
    return best;
  }
  // boats stay out of the buildings
  const clear = props.filter((p) => p.arch !== 'boat' || topAt(p.x, p.z) === -Infinity);
  return { items, props: clear, topAt, flightTopAt: createFlightObstacleIndex(items), roofSpots };
}

// base centre and orientation of box i (leaning towers tilt about their base)
const _e = new THREE.Euler(), _tilt = new THREE.Quaternion(), _axis = new THREE.Vector3(), _up = new THREE.Vector3();
export function ruinFrame(items, i, p, q) {
  const it = items[i];
  q.setFromEuler(_e.set(0, it.yaw, 0));
  _axis.set(Math.cos(it.leanDir), 0, Math.sin(it.leanDir));
  _tilt.setFromAxisAngle(_axis, it.lean);
  q.premultiply(_tilt);
  p.set(it.x, it.y, it.z);
  if (it.onTop) {
    // keep the setback on its (leaning) parent's roof
    _up.set(0, 1, 0).applyQuaternion(_tilt);
    p.set(it.x, items[i - 1].y, it.z).addScaledVector(_up, items[i - 1].h);
  }
}

// Navigation uses conservative world-space bounds, including the full height of open
// and collapsed ruins. Shore geometry keeps its separate, narrower roof lookup.
export function createFlightObstacleIndex(items) {
  const CELL = 64, grid = new Map();
  const key = (x, z) => `${x},${z}`;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), corner = new THREE.Vector3();
  for (let index = 0; index < items.length; index++) {
    const it = items[index];
    ruinFrame(items, index, p, q);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, top = -Infinity;
    for (const x of [-it.w / 2, it.w / 2]) for (const y of [0, it.h]) for (const z of [-it.d / 2, it.d / 2]) {
      corner.set(x, y, z).applyQuaternion(q).add(p);
      minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
      minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
      top = Math.max(top, corner.y);
    }
    if (top <= 0) continue;
    const bounds = { minX, maxX, minZ, maxZ, top };
    for (let x = Math.floor(minX / CELL); x <= Math.floor(maxX / CELL); x++)
      for (let z = Math.floor(minZ / CELL); z <= Math.floor(maxZ / CELL); z++) {
        const k = key(x, z);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(bounds);
      }
  }
  return (x, z) => {
    const candidates = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
    let top = -Infinity;
    for (const b of candidates)
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) top = Math.max(top, b.top);
    return top;
  };
}

// patchCustom: terrain.patchCustom (underwater light, caustics, fog + our surface)
export function buildRuins({ items: buildings, props }, patchCustom) {
  const items = buildings.concat(props);
  // EON rough diffuse (three r187): concrete and plaster go flat and dusty like the real thing
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.8, diffuseRoughness: 0.8 });
  const surface = ruinSurface();
  patchCustom(mat, surface.uniforms, surface.ext);
  const nearestCity = (it) => CITIES.reduce((best, c, i) => (Math.hypot(it.x - c.x, it.z - c.z) < Math.hypot(it.x - CITIES[best].x, it.z - CITIES[best].z) ? i : best), 0);
  const group = new THREE.Group();
  for (const mesh of buildRuinMeshes(items, mat, ruinFrame, nearestCity)) group.add(mesh);
  group.userData.material = mat;   // the landmarks share it
  return group;
}