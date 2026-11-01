import * as THREE from 'three';
import { LANDMARKS, worldHeight } from './worldHeight.js';
import { Builder, KIND } from './ruinGeometry.js';

// The big wrecks between the cities, each something to fly to: a snapped suspension
// bridge, a container ship run aground, a lighthouse on its rock, a fallen ferris wheel, a
// leaning radio mast and a flooded stadium. Built from the same pieces as the ruins (and
// shaded by the same material, plus kind 3: painted containers) in the landmark's frame:
// x along its length, y up from sea level.

function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

// a square beam of side t from a to b
function beam(B, a, b, t, kind) {
  _d.subVectors(b, a);
  const L = _d.length();
  if (L < 0.01) return;
  _q.setFromUnitVectors(_y, _d.divideScalar(L));
  B.box(a.x - t / 2, a.y, a.z - t / 2, a.x + t / 2, a.y + L, a.z + t / 2, kind, { rot: _e.setFromQuaternion(_q), pivot: a });
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// --- the pieces --------------------------------------------------------------------------

// suspension bridge along x: two pylons, a deck with a gap where the middle fell, cables
function bridge(B, rand, foot) {
  const deckY = 16, hw = 11, pyl = [-190, 190], top = 88, gap = [-35, 70];
  for (const px of pyl) {
    for (const sz of [-1, 1]) B.box(px - 3, -14, sz * hw - 3, px + 3, top, sz * hw + 3, KIND.concrete);
    for (const y of [deckY - 3, 50, top - 4]) B.box(px - 2, y, -hw, px + 2, y + 3.5, hw, KIND.concrete);
    foot.push({ x0: px - 4, z0: -hw - 4, x1: px + 4, z1: hw + 4, top, wet: true });
  }
  // the deck, in spans between piers; the two ends at the gap sag down towards the water
  const spans = [[-430, -190], [-190, gap[0]], [gap[1], 190], [190, 430]];
  spans.forEach(([x0, x1], i) => {
    const droop = i === 1 ? new THREE.Euler(0, 0, -0.16) : i === 2 ? new THREE.Euler(0, 0, 0.11) : null;
    const pivot = i === 1 ? V(x0, deckY, 0) : V(x1, deckY, 0);
    B.box(x0, deckY - 1.6, -hw, x1, deckY, hw, KIND.concrete, { rot: droop, pivot, bottom: true });
    B.box(x0, deckY, -hw, x1, deckY + 1.1, -hw + 0.35, KIND.metal, { rot: droop, pivot });   // railings
    B.box(x0, deckY, hw - 0.35, x1, deckY + 1.1, hw, KIND.metal, { rot: droop, pivot });
    foot.push({ x0, z0: -hw, x1, z1: hw, top: deckY + 1, wet: false });
  });
  for (let x = -400; x <= 400; x += 70) {
    if (Math.abs(Math.abs(x) - 190) < 30 || (x > gap[0] - 40 && x < gap[1] + 40)) continue;
    B.box(x - 2.5, -14, -hw + 2, x + 2.5, deckY - 1.6, hw - 2, KIND.concrete);
    foot.push({ x0: x - 3, z0: -hw, x1: x + 3, z1: hw, top: deckY, wet: true });
  }
  // a fallen deck section half out of the water in the gap
  B.box(gap[0] + 12, -6, -hw, gap[1] - 18, -1.6 + 3, hw, KIND.concrete, { rot: new THREE.Euler(0.05, 0.08, 0.1) });
  foot.push({ x0: gap[0] + 10, z0: -hw, x1: gap[1] - 16, z1: hw, top: 2, wet: true });
  // main cables (parabolas between the pylon tops, straight down to the anchorages) and
  // hangers; on the broken side one cable snapped and hangs into the sea
  for (const sz of [-1, 1]) {
    const z = sz * hw;
    const cable = (x) => {
      if (x < pyl[0]) return deckY + 2 + (top - deckY - 2) * (x + 430) / (pyl[0] + 430);
      if (x > pyl[1]) return deckY + 2 + (top - deckY - 2) * (430 - x) / (430 - pyl[1]);
      const u = x / pyl[1];
      return deckY + 6 + (top - deckY - 6) * u * u;
    };
    const snapped = sz > 0;
    let prev = V(-430, cable(-430), z);
    for (let x = -420; x <= 430; x += 10) {
      let p = V(x, cable(x), z);
      if (snapped && x > gap[0] && x < pyl[1]) {
        // from the right pylon the loose end drapes down to the water
        const t = (pyl[1] - x) / (pyl[1] - gap[0]);
        p = V(x, top - (top + 2) * Math.pow(t, 0.6), z + sz * 8 * t);
        if (x < gap[0] + 10) { prev = p; continue; }
      }
      beam(B, prev, p, 0.7, KIND.metal);
      const onDeck = !(x > gap[0] - 5 && x < gap[1] + 5) && Math.abs(Math.abs(x) - 190) > 6;
      if (x % 20 === 0 && onDeck && !(snapped && x > gap[0] && x < pyl[1]) && rand() > 0.12) beam(B, V(x, deckY + 1, z), p, 0.18, KIND.metal);
      prev = p;
    }
  }
}

// a container ship aground in the shallows: listing, bow down, half her stacks gone
function ship(B, rand, foot) {
  const L = 190, hb = 16, draft = -11, deckY = 5;
  // hull in slices: full beam aft, fining to the bow (+x)
  const N = 26;
  for (let i = 0; i < N; i++) {
    const x0 = -L / 2 + (i / N) * L, x1 = x0 + L / N, u = (x0 + x1) / 2 / (L / 2);
    const w = hb * (u > 0.45 ? Math.sqrt(Math.max(0.02, 1 - Math.pow((u - 0.45) / 0.55, 2))) : u < -0.9 ? 0.85 : 1);
    B.box(x0, draft + Math.max(0, u - 0.7) * 6, -w, x1, deckY + Math.max(0, u - 0.6) * 5, w, KIND.metal);
  }
  foot.push({ x0: -L / 2, z0: -hb, x1: L / 2, z1: hb, top: deckY + 4, wet: true });
  // bridge house aft, with its funnel
  B.box(-L / 2 + 8, deckY, -hb + 1, -L / 2 + 22, deckY + 22, hb - 1, KIND.facade);
  B.box(-L / 2 + 6, deckY + 22, -hb - 2, -L / 2 + 24, deckY + 23, hb + 2, KIND.concrete);   // bridge wings
  B.cylinder(-L / 2 + 3, deckY, 0, 3.2, 26, KIND.metal, 12);
  foot.push({ x0: -L / 2, z0: -hb - 2, x1: -L / 2 + 24, z1: hb + 2, top: deckY + 28, wet: true });
  // container bays: rows of 12 m boxes, stacked, gaps where they went overboard
  const cw = 2.5, ch = 2.6, cl = 12.2;
  for (let bx = -L / 2 + 28; bx < L / 2 - 30; bx += cl + 0.8) {
    const u = (bx + cl / 2) / (L / 2), half = u > 0.45 ? hb * 0.75 : hb - 1.5;
    for (let z = -half; z + cw <= half; z += cw + 0.08) {
      const tiers = Math.floor(rand() * rand() * 6);
      for (let k = 0; k < tiers; k++) {
        B.origin.set(bx * 13.1 + z * 3.7, k, z * 7.3 + k * 11.9);   // seed: each box its own paint
        B.box(bx, deckY + k * ch, z, bx + cl, deckY + (k + 1) * ch - 0.05, z + cw, KIND.container);
      }
    }
  }
  // the ones that went over the side, tumbled in the shallows
  for (let i = 0; i < 26; i++) {
    const x = (rand() - 0.5) * L * 1.1, side = rand() < 0.7 ? 1 : -1, z = side * (hb + 4 + rand() * 30);
    B.origin.set(x * 5.3, i, z * 2.1);
    B.box(x - cl / 2, -2.8, z - cw / 2, x + cl / 2, -0.2 + rand() * 1.5, z + cw / 2, KIND.container,
      { rot: new THREE.Euler((rand() - 0.5) * 0.6, rand() * 3, (rand() - 0.5) * 0.9) });
  }
}

// lighthouse on its rock: a tapering white tower, gallery and lantern, the keeper's house
function lighthouse(B, rand, foot, ground) {
  const y0 = ground - 1;
  for (let i = 0; i < 9; i++) B.cylinder(0, y0 + i * 3.6, 0, 4.6 - i * 0.18, 3.62, KIND.paint, 16);
  const yt = y0 + 9 * 3.6;
  B.cylinder(0, yt, 0, 4.4, 0.5, KIND.concrete, 16);            // gallery floor
  for (let i = 0; i < 16; i++) {                                  // its railing posts
    const a = (i / 16) * Math.PI * 2;
    B.box(Math.cos(a) * 4.2 - 0.06, yt + 0.5, Math.sin(a) * 4.2 - 0.06, Math.cos(a) * 4.2 + 0.06, yt + 1.6, Math.sin(a) * 4.2 + 0.06, KIND.metal);
  }
  B.cylinder(0, yt + 0.5, 0, 2.4, 3.4, KIND.metal, 12);         // lantern room
  B.cylinder(0, yt + 3.9, 0, 2.7, 0.5, KIND.metal, 12);
  B.cylinder(0, yt + 4.4, 0, 1.2, 1.2, KIND.metal, 8);
  B.box(7, ground - 1, -4, 17, ground + 4.5, 4, KIND.paint);   // keeper's house
  B.box(6.5, ground + 4.5, -4.5, 17.5, ground + 5, 4.5, KIND.concrete);
  foot.push({ x0: -5, z0: -5, x1: 5, z1: 5, top: yt + 6, wet: true });
  // a jetty out into the water, half its planks gone
  for (let x = -12; x > -60; x -= 4) if (rand() > 0.25) B.box(x - 1.8, 0.6, -1.5, x + 1.8, 1.1, 1.5, KIND.concrete);
  for (let x = -14; x > -60; x -= 8) B.box(x - 0.3, -4, -1.6, x + 0.3, 0.8, -1, KIND.metal), B.box(x - 0.3, -4, 1, x + 0.3, 0.8, 1.6, KIND.metal);
}

// a ferris wheel toppled onto its side frame: half in the water, leaning over
function wheel(B, rand, foot) {
  const R = 46, cy = 30, n = 48, w = 3.2;
  const pt = (i, z) => { const a = (i / n) * Math.PI * 2; return V(Math.cos(a) * R, cy + Math.sin(a) * R, z); };
  for (let i = 0; i < n; i++) {
    if (i === 31 || i === 32) continue;                           // a broken run of the rim
    for (const z of [-w, w]) beam(B, pt(i, z), pt(i + 1, z), 0.9, KIND.metal);
    beam(B, pt(i, -w), pt(i, w), 0.4, KIND.metal);
    if (i % 2 === 0) {
      for (const z of [-w, w]) beam(B, V(0, cy, z * 0.4), pt(i, z), 0.35, KIND.metal);   // spokes
      if (rand() < 0.7 && pt(i, 0).y > -2) {                      // gondolas hanging below the rim
        const p = pt(i, 0), s = 2;
        B.box(p.x - s, p.y - 5.5, -s, p.x + s, p.y - 1.5, s, KIND.container, { rot: new THREE.Euler(0, 0, (rand() - 0.5) * 0.4), pivot: V(p.x, p.y, 0) });
        beam(B, V(p.x, p.y - 1.5, 0), p, 0.2, KIND.metal);
      }
    }
  }
  B.cylinder(0, cy - 2, -w * 1.5, 2.2, 0.01, KIND.metal);
  beam(B, V(0, cy, -w * 1.6), V(0, cy, w * 1.6), 2.4, KIND.metal);   // hub
  // the A-frame legs
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) beam(B, V(sx * 26, -8, sz * 13), V(0, cy, sz * w * 1.4), 1.6, KIND.metal);
  foot.push({ x0: -R, z0: -14, x1: R, z1: 14, top: cy + R, wet: false });
  foot.push({ x0: -R, z0: -6, x1: R, z1: 6, top: 2, wet: true });
}

// a lattice radio mast, leaning hard: triangular, tapering, braced in X
function tower(B, rand, foot, ground) {
  const H = 132, seg = 8;
  const leg = (k, y) => { const r = 9 * (1 - y / H) + 1.2, a = (k / 3) * Math.PI * 2; return V(Math.cos(a) * r, ground + y, Math.sin(a) * r); };
  for (let y = 0; y < H; y += seg) {
    const y1 = Math.min(H, y + seg);
    for (let k = 0; k < 3; k++) {
      const a0 = leg(k, y), a1 = leg(k, y1), b0 = leg(k + 1, y), b1 = leg(k + 1, y1);
      beam(B, a0, a1, 0.7, KIND.metal);
      beam(B, a0, b1, 0.25, KIND.metal);
      beam(B, b0, a1, 0.25, KIND.metal);
      beam(B, a1, b1, 0.3, KIND.metal);
    }
    // dish antennas and platforms here and there
    if (y > 30 && rand() < 0.25) B.cylinder(leg(0, y).x + 1.5, ground + y + 2, 0, 2.2, 0.4, KIND.metal, 12);
    if (y % 40 === 0 && y > 0) B.cylinder(0, ground + y, 0, 9 * (1 - y / H) + 2.6, 0.3, KIND.metal, 12);
  }
  beam(B, V(0, ground + H, 0), V(0, ground + H + 14, 0), 0.4, KIND.metal);
  B.box(-10, ground - 1, -10, 10, ground + 1.2, 10, KIND.concrete);   // footing
  foot.push({ x0: -12, z0: -12, x1: 12, z1: 12, top: ground + 2, wet: true });
}

// a stadium bowl under the sea: tiers of seats, the upper rim and roof stubs above water,
// floodlight masts; a quarter of the stands have slid in
function stadium(B, rand, foot) {
  const rx = 115, rz = 82, n = 64, base = -11;
  const rad = (a, s) => V(Math.cos(a) * rx * s, 0, Math.sin(a) * rz * s);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const fallen = a > 3.6 && a < 4.9;
    const drop = fallen ? -4 - 6 * Math.sin((a - 3.6) / 1.3 * Math.PI) : 0;
    const tiers = fallen ? 6 : 12 - Math.floor(rand() * rand() * 7);   // a ragged top edge
    for (let k = 0; k < tiers; k++) {
      // each tier a slab between two ellipses (built as a quad strip of thin boxes)
      const s0 = 0.78 + k * 0.025, s1 = s0 + 0.026, y = base + 1.4 * k + drop;
      const p0 = rad(a, s0), p1 = rad(a1, s0), q0 = rad(a, s1), q1 = rad(a1, s1);
      const c = p0.clone().add(p1).add(q0).add(q1).multiplyScalar(0.25);
      const along = p1.clone().sub(p0), len = along.length() + 0.15, depth = q0.distanceTo(p0);
      const yaw = -Math.atan2(along.z, along.x);
      B.box(c.x - len / 2, y, c.z - depth / 2, c.x + len / 2, y + 1.4, c.z + depth / 2, KIND.concrete, { rot: new THREE.Euler(0, yaw, 0), pivot: c });
    }
    if (fallen || rand() < 0.18) continue;
    // the outer wall with its concourse openings, and roof trusses on some bays
    const s = 0.78 + 12 * 0.025 + 0.03, o0 = rad(a, s), o1 = rad(a1, s), c = o0.clone().add(o1).multiplyScalar(0.5);
    const along = o1.clone().sub(o0), len = along.length() + 0.2, yaw = -Math.atan2(along.z, along.x);
    B.box(c.x - len / 2, base, c.z - 0.6, c.x + len / 2, base + tiers * 1.4 + 1 + rand() * 3, c.z + 0.6, KIND.facade, { rot: new THREE.Euler(0, yaw, 0), pivot: c });
    if (i % 2 === 0 && rand() < 0.6) {
      const top = base + 12 * 1.4 + 3, inner = rad(a, 0.86);
      beam(B, V(c.x, top, c.z), V(inner.x, top + 4, inner.z), 0.8, KIND.metal);
    }
  }
  for (const a of [0.6, 2.5, 3.8, 5.7]) {
    const p = rad(a, 1.18);
    const fallen = a === 3.8;
    const topP = fallen ? V(p.x + 38, -1, p.z - 12) : V(p.x, 48, p.z);
    beam(B, V(p.x, base, p.z), topP, 1.4, KIND.metal);
    B.box(topP.x - 4, topP.y, topP.z - 1, topP.x + 4, topP.y + 4, topP.z + 1, KIND.metal, { rot: new THREE.Euler(0, -a, fallen ? 1.2 : 0.3), pivot: topP });
    if (!fallen) foot.push({ x0: p.x - 4, z0: p.z - 4, x1: p.x + 4, z1: p.z + 4, top: 52, wet: true });
  }
  // the rim breaks the surface: foam rings the bowl
  foot.push({ ring: true, rx: rx * 1.1, rz: rz * 1.1, w: 0.12, top: base + 12 * 1.4 + 3, wet: true });
}

const BUILD = { bridge, ship, lighthouse, wheel, tower, stadium };
// a bit of lean on the ones that are falling
const TILT = { wheel: new THREE.Euler(0.32, 0, 0.05), tower: new THREE.Euler(0.21, 0, -0.06), ship: new THREE.Euler(0.12, 0, -0.025) };

export function planLandmarks() {
  return LANDMARKS.map((l, i) => {
    const ground = l.type === 'lighthouse' || l.type === 'tower' ? worldHeight(l.x, l.z) : 0;
    return { ...l, i, ground, foot: [], c: Math.cos(l.yaw), s: Math.sin(l.yaw), R: { bridge: 450, ship: 140, lighthouse: 70, wheel: 60, tower: 30, stadium: 150 }[l.type] };
  });
}

// local footprints -> heights. all: obstacles for the flight floor, wet: what the shore map
// should treat as land (things standing in the water, not a deck high above it)
function topAtFn(plan, wetOnly) {
  return (x, z) => {
    let best = -Infinity;
    for (const l of plan) {
      const dx = x - l.x, dz = z - l.z;
      if (dx * dx + dz * dz > l.R * l.R) continue;
      const lx = dx * l.c - dz * l.s, lz = dx * l.s + dz * l.c;
      for (const f of l.foot) {
        if (wetOnly && !f.wet) continue;
        if (f.ring) {
          const e = Math.hypot(lx / f.rx, lz / f.rz);
          if (Math.abs(e - 0.95) < f.w) best = Math.max(best, f.top);
        } else if (lx > f.x0 && lx < f.x1 && lz > f.z0 && lz < f.z1) best = Math.max(best, f.top);
      }
    }
    return best;
  };
}

export function buildLandmarks(plan, material) {
  const group = new THREE.Group(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  for (const l of plan) {
    const B = new Builder();
    q.setFromEuler(new THREE.Euler(0, l.yaw, 0));
    if (TILT[l.type]) q.multiply(new THREE.Quaternion().setFromEuler(TILT[l.type]));
    B.frame(p.set(l.x, 0, l.z), q, new THREE.Vector3(l.x, 0, l.z));
    l.foot.length = 0;
    BUILD[l.type](B, rng(1000 + l.i * 7919), l.foot, l.ground);
    const mesh = new THREE.Mesh(B.geometry(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = l.type;
    group.add(mesh);
  }
  return group;
}

// footprints are filled while building; call after buildLandmarks
export function landmarkTops(plan) {
  return { topAt: topAtFn(plan, false), wetTopAt: topAtFn(plan, true) };
}
