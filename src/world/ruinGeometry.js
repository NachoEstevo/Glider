import * as THREE from 'three';

// Detailed ruin geometry, one merged mesh per city. Each plan item (ruins.js) becomes a
// building of its archetype, built from boxes and a few cylinders in its own metres:
//   intact    walls, floor ledges or balconies, parapet, roof clutter (tanks, AC, stair hut)
//   collapsed walls up to hb, above it a concrete skeleton: columns, hanging slabs, wall shards
//   stepped   four blocks of different heights, rubble down the low side
//   skeleton  just the frame: columns and broken floor slabs (mostly the drowned ones)
// Attributes for the shader (ruinMaterial.js): aLocal / aLocalN (position and normal in the
// building frame), aInfo (xyz: building origin, a stable seed; w: kind 0 facade, 1 concrete,
// 2 rusted metal, 3 painted steel: containers, gondolas, 4 lime-washed masonry).
const FLOOR = 3.6;
export const KIND = { facade: 0, concrete: 1, metal: 2, container: 3, paint: 4 };

function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.loc = []; this.locN = []; this.info = []; this.idx = [];
    this.q = new THREE.Quaternion(); this.p = new THREE.Vector3(); this.origin = new THREE.Vector3();
    this._v = new THREE.Vector3(); this._n = new THREE.Vector3();
  }

  frame(p, q, origin) { this.p.copy(p); this.q.copy(q); this.origin.copy(origin); }

  // a quad in local space: corners a b c d, outward normal n (winding fixed up here)
  quad(a, b, c, d, n, kind) {
    const e1 = b.clone().sub(a), e2 = c.clone().sub(a);
    const pts = e1.cross(e2).dot(n) >= 0 ? [a, b, c, d] : [a, d, c, b];
    const base = this.pos.length / 3;
    for (const v of pts) {
      this.loc.push(v.x, v.y, v.z);
      this.locN.push(n.x, n.y, n.z);
      this._v.copy(v).applyQuaternion(this.q).add(this.p);
      this.pos.push(this._v.x, this._v.y, this._v.z);
      this._n.copy(n).applyQuaternion(this.q);
      this.nrm.push(this._n.x, this._n.y, this._n.z);
      this.info.push(this.origin.x, this.origin.y, this.origin.z, kind);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // axis-aligned box [x0,x1]x[y0,y1]x[z0,z1], optionally turned by rot (Euler) about pivot
  box(x0, y0, z0, x1, y1, z1, kind, { rot = null, pivot = null, bottom = false } = {}) {
    if (x1 - x0 < 0.01 || y1 - y0 < 0.01 || z1 - z0 < 0.01) return;
    const c = [];
    for (let i = 0; i < 8; i++) c.push(new THREE.Vector3(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0));
    const N = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    if (rot) {
      const q = new THREE.Quaternion().setFromEuler(rot), pv = pivot ?? new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      for (const v of c) v.sub(pv).applyQuaternion(q).add(pv);
      for (const n of N) n.applyQuaternion(q);
    }
    this.quad(c[1], c[3], c[7], c[5], N[0], kind);
    this.quad(c[0], c[4], c[6], c[2], N[1], kind);
    this.quad(c[2], c[6], c[7], c[3], N[2], kind);
    if (bottom) this.quad(c[0], c[1], c[5], c[4], N[3], kind);
    this.quad(c[4], c[5], c[7], c[6], N[4], kind);
    this.quad(c[0], c[2], c[3], c[1], N[5], kind);
  }

  // A chipped slab footprint, with independently sized corners and real edge faces.
  chippedBox(x0, y0, z0, x1, y1, z1, kind, rand, { rot = null, pivot = null } = {}) {
    const dx = x1 - x0, dz = z1 - z0;
    if (dx < 0.05 || dz < 0.05 || y1 - y0 < 0.01) return;
    const cut = () => 0.08 + rand() * 0.16;
    const c = Array.from({ length: 8 }, cut);
    const ring = [[x0 + dx*c[0], z0], [x1 - dx*c[1], z0], [x1, z0 + dz*c[2]],
      [x1, z1 - dz*c[3]], [x1 - dx*c[4], z1], [x0 + dx*c[5], z1],
      [x0, z1 - dz*c[6]], [x0, z0 + dz*c[7]]];
    const pv = pivot ?? new THREE.Vector3((x0+x1)/2, (y0+y1)/2, (z0+z1)/2);
    const q = rot && new THREE.Quaternion().setFromEuler(rot);
    const point = (x, y, z) => { const v = new THREE.Vector3(x, y, z); return q ? v.sub(pv).applyQuaternion(q).add(pv) : v; };
    const normal = (x, y, z) => { const v = new THREE.Vector3(x, y, z); return q ? v.applyQuaternion(q) : v; };
    const centre = point((x0+x1)/2, y1, (z0+z1)/2);
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i+1)%ring.length];
      const a = point(ax,y1,az), b = point(bx,y1,bz);
      this.quad(centre, a, b, centre.clone(), normal(0,1,0), kind);
      const n = normal(bz-az, 0, ax-bx).normalize();
      this.quad(point(ax,y0,az), point(bx,y0,bz), b, a, n, kind);
    }
  }

  cylinder(cx, y0, cz, r, h, kind, seg = 10) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p = (a, y) => new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      this.quad(p(a0, y0), p(a1, y0), p(a1, y0 + h), p(a0, y0 + h), new THREE.Vector3(Math.cos(am), 0, Math.sin(am)), kind);
      // cap as thin wedges (quads with a doubled centre)
      const ctr = new THREE.Vector3(cx, y0 + h, cz);
      this.quad(ctr, ctr.clone(), p(a1, y0 + h), p(a0, y0 + h), new THREE.Vector3(0, 1, 0), kind);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.loc, 3));
    g.setAttribute('aLocalN', new THREE.Float32BufferAttribute(this.locN, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// --- pieces ---------------------------------------------------------------------------

function parapet(B, w, d, y, t = 0.3, hgt = 0.9) {
  const hw = w / 2, hd = d / 2;
  B.box(-hw, y, -hd, hw, y + hgt, -hd + t, KIND.concrete);
  B.box(-hw, y, hd - t, hw, y + hgt, hd, KIND.concrete);
  B.box(-hw, y, -hd + t, -hw + t, y + hgt, hd - t, KIND.concrete);
  B.box(hw - t, y, -hd + t, hw, y + hgt, hd - t, KIND.concrete);
}

// floor bands: thin concrete strips running round the building
function ledges(B, w, d, y0, y1, every, out = 0.22) {
  const hw = w / 2 + out, hd = d / 2 + out;
  for (let y = y0 + FLOOR * every; y < y1 - 1; y += FLOOR * every) {
    B.box(-hw, y - 0.16, -hd, hw, y + 0.16, -hd + out + 0.05, KIND.concrete);
    B.box(-hw, y - 0.16, hd - out - 0.05, hw, y + 0.16, hd, KIND.concrete);
    B.box(-hw, y - 0.16, -hd, -hw + out + 0.05, y + 0.16, hd, KIND.concrete);
    B.box(hw - out - 0.05, y - 0.16, -hd, hw, y + 0.16, hd, KIND.concrete);
  }
}

// balconies on one face (side: 0 +z, 1 -z, 2 +x, 3 -x), some missing, some sagging
function balconies(B, rand, w, d, h, side) {
  const along = side < 2 ? w : d, bays = Math.max(1, Math.floor(along / 3.6)), depth = 1.3;
  for (let y = FLOOR; y < h - 1.5; y += FLOOR) for (let b = 0; b < bays; b++) {
    if (rand() < 0.35) continue;
    const a0 = -along / 2 + b * (along / bays) + 0.3, a1 = a0 + along / bays - 0.6;
    const sag = rand() < 0.12 ? new THREE.Euler((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.3) : null;
    const slab = (p, q) => {   // (along, out) -> local box
      if (side === 0) return [a0, y - 0.12, d / 2 + p, a1, y + 0.12, d / 2 + q];
      if (side === 1) return [a0, y - 0.12, -d / 2 - q, a1, y + 0.12, -d / 2 - p];
      if (side === 2) return [w / 2 + p, y - 0.12, a0, w / 2 + q, y + 0.12, a1];
      return [-w / 2 - q, y - 0.12, a0, -w / 2 - p, y + 0.12, a1];
    };
    const [x0, y0, z0, x1, y1, z1] = slab(0, depth);
    const pivot = new THREE.Vector3(side === 2 ? w / 2 : side === 3 ? -w / 2 : (x0 + x1) / 2, y, side === 0 ? d / 2 : side === 1 ? -d / 2 : (z0 + z1) / 2);
    B.box(x0, y0, z0, x1, y1, z1, KIND.concrete, { rot: sag, pivot });
    // the low wall at the balcony's front
    if (rand() < 0.75) {
      const [fx0, , fz0, fx1, , fz1] = slab(depth - 0.12, depth);
      B.box(fx0, y + 0.12, fz0, fx1, y + 1.05, fz1, KIND.concrete, { rot: sag, pivot });
    }
  }
}

function roofClutter(B, rand, w, d, y) {
  const hw = w / 2 - 2, hd = d / 2 - 2;
  if (hw < 1 || hd < 1) return;
  const at = () => [(rand() * 2 - 1) * hw, (rand() * 2 - 1) * hd];
  if (rand() < 0.55) {   // water tank on legs
    const [x, z] = at(), r = 1 + rand() * 0.6, legs = 1.4 + rand();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box(x + sx * r * 0.6 - 0.1, y, z + sz * r * 0.6 - 0.1, x + sx * r * 0.6 + 0.1, y + legs, z + sz * r * 0.6 + 0.1, KIND.metal);
    B.cylinder(x, y + legs, z, r, 1.6 + rand(), KIND.metal);
  }
  if (rand() < 0.6) {   // stair hut
    const [x, z] = at();
    B.box(x - 1.6, y, z - 1.4, x + 1.6, y + 2.8, z + 1.4, KIND.concrete);
  }
  for (let i = 0, n = Math.floor(rand() * 5); i < n; i++) {   // AC units, vents
    const [x, z] = at(), s = 0.5 + rand() * 0.6;
    B.box(x - s, y, z - s * 0.7, x + s, y + 0.5 + rand() * 0.7, z + s * 0.7, KIND.metal, { rot: new THREE.Euler(0, rand() * 3, 0) });
  }
  if (rand() < 0.25) {   // antenna mast
    const [x, z] = at(), hgt = 4 + rand() * 6;
    B.box(x - 0.08, y, z - 0.08, x + 0.08, y + hgt, z + 0.08, KIND.metal, { rot: new THREE.Euler((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4), pivot: new THREE.Vector3(x, y, z) });
  }
}

// the clutter of lived-in walls, above the water: AC boxes under windows, drainpipes down the
// corners, the odd sagging awning and a rusted sign (on the 3.6 m window grid of the shader)
function facadeClutter(B, rand, w, d, hb, yMin) {
  for (let side = 0; side < 4; side++) {
    const along = side < 2 ? w : d, half = side < 2 ? d / 2 : w / 2, sn = side % 2 ? -1 : 1;
    // (a, y, out) on this face -> local box corners
    const put = (a0, y0, o0, a1, y1, o1, kind, rot = null) => {
      if (side < 2) B.box(a0, y0, sn > 0 ? half + o0 : -half - o1, a1, y1, sn > 0 ? half + o1 : -half - o0, kind, { rot });
      else B.box(sn > 0 ? half + o0 : -half - o1, y0, a0, sn > 0 ? half + o1 : -half - o0, y1, a1, kind, { rot });
    };
    const bays = Math.floor(along / 3.6);
    for (let f = Math.max(1, Math.ceil(yMin / 3.6)); f * 3.6 < hb - 1; f++) for (let b = 0; b < bays; b++) {
      if (rand() > 0.07) continue;
      const a = -along / 2 + (b + 0.5) * (along / bays) + (rand() - 0.5) * 0.8, y = f * 3.6 + 0.4;
      put(a - 0.45, y, 0, a + 0.45, y + 0.6, 0.55, KIND.metal);                                // AC unit
    }
    if (rand() < 0.5) {   // drainpipe near a corner
      const a = (rand() < 0.5 ? -1 : 1) * (along / 2 - 0.4);
      put(a - 0.09, Math.max(0, yMin), 0, a + 0.09, hb - 0.3, 0.18, KIND.metal);
    }
    if (hb > 4 && rand() < 0.3 && yMin < 1) {   // a torn awning over the ground floor, sagging
      const a = (rand() - 0.5) * (along - 4);
      put(a - 1.6, 3.0, 0, a + 1.6, 3.12, 1.4, KIND.container, new THREE.Euler((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.3));
    }
    if (hb > 10 && rand() < 0.12) {   // a rusted sign hanging off the wall
      const y = 6 + rand() * (hb - 10), a = (rand() - 0.5) * (along - 3);
      put(a - 0.15, y, 0.2, a + 0.15, y + 3.5, 1.4, KIND.container, new THREE.Euler(0, 0, (rand() - 0.5) * 0.25));
    }
  }
}

// A bounded selection of actual projecting jambs and sills. The painted openings use
// the same 3.6 m grid and dimensions; the wall behind remains the window surface.
function windowReveals(B, w, d, h, yMin) {
  const candidates = [];
  for (let side = 0; side < 4; side++) {
    const along = side < 2 ? w : d;
    const half = along / 2;
    for (let f = Math.max(0, Math.floor(yMin / FLOOR)); f * FLOOR < h; f++) {
      const ground = f === 0, wh = ground ? 0.78 : 0.53, wy = ground ? 0.42 : 0.56;
      const y0 = (f + wy - wh/2) * FLOOR, y1 = (f + wy + wh/2) * FLOOR;
      if (y0 < Math.max(0, yMin) || y1 > h - 0.2) continue;
      for (let cell = Math.ceil(-half/FLOOR - 0.5); (cell + 0.5)*FLOOR < half; cell++) {
        const a = (cell + 0.5)*FLOOR, hw = 0.56 * FLOOR / 2;
        if (a - hw < -half + 0.12 || a + hw > half - 0.12) continue;
        candidates.push({ side, a, hw, y0, y1 });
      }
    }
  }
  const count = Math.min(4, candidates.length);
  for (let i = 0; i < count; i++) {
    const { side, a, hw, y0, y1 } = candidates[Math.floor((i + 0.5) * candidates.length / count)];
    const sn = side % 2 ? -1 : 1, depth = side < 2 ? d/2 : w/2;
    const point = (u, y, out) => side < 2 ? new THREE.Vector3(u,y,sn*(depth+out)) : new THREE.Vector3(sn*(depth+out),y,u);
    const face = new THREE.Vector3(side < 2 ? 0 : sn, 0, side < 2 ? sn : 0);
    const emit = (u0,v0,o0,u1,v1,o1,n) => B.quad(point(u0,v0,o0), point(u1,v0,o0), point(u1,v1,o1), point(u0,v1,o1), n, KIND.concrete);
    const lip = 0.18, trim = 0.07;
    // Front trim and inward-facing surfaces make the opening read as a deep reveal.
    for (const u of [a-hw, a+hw]) {
      const s = u < a ? -1 : 1;
      emit(u+s*trim,y0,lip,u,y1,lip,face);
      const n = side < 2 ? new THREE.Vector3(-s,0,0) : new THREE.Vector3(0,0,-s);
      B.quad(point(u,y0,0.008),point(u,y1,0.008),point(u,y1,lip),point(u,y0,lip),n,KIND.concrete);
    }
    for (const y of [y0,y1]) {
      const s = y === y0 ? -1 : 1;
      emit(a-hw,y+s*trim,lip,a+hw,y,lip,face);
      B.quad(point(a-hw,y,0.008),point(a+hw,y,0.008),point(a+hw,y,lip),point(a-hw,y,lip),new THREE.Vector3(0,-s,0),KIND.concrete);
    }
  }
}

// columns, floor slabs (partial, some hanging off an edge) and shards of facade
function skeleton(B, rand, w, d, y0, y1, full) {
  const nx = Math.max(2, Math.round(w / 6.5) + 1), nz = Math.max(2, Math.round(d / 6.5) + 1);
  const col = 0.32;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    if (rand() < 0.12) continue;
    const x = -w / 2 + 0.5 + (i / (nx - 1)) * (w - 1), z = -d / 2 + 0.5 + (k / (nz - 1)) * (d - 1);
    const top = y0 + (y1 - y0) * (full ? 0.75 + rand() * 0.25 : 0.25 + rand() * 0.75);
    B.box(x - col, y0, z - col, x + col, top, z + col, KIND.concrete);
    if (rand() < 0.3) B.box(x - 0.04, top, z - 0.04, x + 0.04, top + 0.8, z + 0.04, KIND.metal);   // rebar
  }
  let k = 0;
  for (let y = y0 + FLOOR; y < y1 - 0.5; y += FLOOR, k++) {
    const up = (y - y0) / Math.max(1, y1 - y0);
    if (rand() < 0.15 + 0.5 * up) continue;
    // a ragged part of the floor: random sub-rectangle
    const fx0 = rand() < 0.5 ? 0 : rand() * 0.5, fx1 = rand() < 0.5 ? 1 : 0.5 + rand() * 0.5;
    const fz0 = rand() < 0.5 ? 0 : rand() * 0.5, fz1 = rand() < 0.5 ? 1 : 0.5 + rand() * 0.5;
    const x0 = -w / 2 + fx0 * w, x1 = -w / 2 + fx1 * w, z0 = -d / 2 + fz0 * d, z1 = -d / 2 + fz1 * d;
    let rot = null, pivot = null;
    if (rand() < 0.25) {   // hanging from one edge
      const ax = rand() < 0.5;
      rot = ax ? new THREE.Euler(0, 0, (rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 0.5)) : new THREE.Euler((rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 0.5), 0, 0);
      pivot = new THREE.Vector3(ax ? x0 : (x0 + x1) / 2, y, ax ? (z0 + z1) / 2 : z0);
    }
    if (rand() < 0.3) B.chippedBox(x0, y - 0.18, z0, x1, y + 0.18, z1, KIND.concrete, rand, { rot, pivot });
    else B.box(x0, y - 0.18, z0, x1, y + 0.18, z1, KIND.concrete, { rot, pivot });
  }
  // shards of the old facade still clinging on
  for (let s = 0; s < 4; s++) {
    if (rand() < (full ? 0.6 : 0.35)) continue;
    const hgt = FLOOR * (1 + Math.floor(rand() * 3)), yb = y0 + FLOOR * Math.floor(rand() * Math.max(1, (y1 - y0 - hgt) / FLOOR));
    const frac = 0.25 + rand() * 0.5, off = (rand() - 0.5) * (1 - frac);
    if (s < 2) {
      const z = s ? d / 2 - 0.2 : -d / 2, x0 = (off - frac / 2) * w, x1 = (off + frac / 2) * w;
      B.box(x0, yb, z, x1, yb + hgt, z + 0.2, KIND.facade);
    } else {
      const x = s === 3 ? w / 2 - 0.2 : -w / 2, z0 = (off - frac / 2) * d, z1 = (off + frac / 2) * d;
      B.box(x, yb, z0, x + 0.2, yb + hgt, z1, KIND.facade);
    }
  }
}

function rubble(B, rand, cx, cz, r, y, n) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, dd = rand() * r, s = 0.8 + rand() * 2.2;
    const x = cx + Math.cos(a) * dd, z = cz + Math.sin(a) * dd;
    const rot = new THREE.Euler((rand() - 0.5) * 0.9, rand() * 3, (rand() - 0.5) * 0.9);
    if (rand() < 0.3) B.chippedBox(x - s, y - 0.3, z - s * 0.6, x + s, y + s * 0.5, z + s * 0.6, KIND.concrete, rand, { rot });
    else B.box(x - s, y - 0.3, z - s * 0.6, x + s, y + s * 0.5, z + s * 0.6, KIND.concrete, { rot });
  }
}

// --- buildings --------------------------------------------------------------------------

// a car on the street floor: body, glasshouse, wheels (x across, z along)
function car(B, w, d) {
  B.box(-w / 2, 0.32, -d / 2, w / 2, 0.95, d / 2, KIND.container);
  B.box(-w / 2 + 0.12, 0.95, -d / 2 + 1.1, w / 2 - 0.12, 1.42, d / 2 - 1.3, KIND.container);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(sx * w / 2 - 0.12, 0, sz * 1.35 - 0.33, sx * w / 2 + 0.12, 0.66, sz * 1.35 + 0.33, KIND.metal);
}

// a small motor boat: a hull fining to the bow (+z), a cabin aft
function boat(B, rand, w, d) {
  const N = 7;
  for (let i = 0; i < N; i++) {
    const z0 = -d / 2 + (i / N) * d, z1 = z0 + d / N, u = (i + 0.5) / N;
    const hw = w / 2 * (u > 0.55 ? Math.sqrt(1 - Math.pow((u - 0.55) / 0.5, 2)) : 1);
    B.box(-hw, -0.6 + u * 0.3, z0, hw, 0.7 + Math.max(0, u - 0.6) * 0.8, z1, KIND.container);
  }
  if (rand() < 0.75) B.box(-w * 0.32, 0.7, -d * 0.3, w * 0.32, 1.9, d * 0.05, KIND.container);
  if (rand() < 0.4) B.box(-0.06, 0.7, d * 0.1, 0.06, 0.7 + d * 0.9, d * 0.1 + 0.12, KIND.metal);   // a mast
}

function building(B, it, rand) {
  const { w, d, h } = it, top = it.y + h;
  if (it.arch === 'car') return car(B, w, d);
  if (it.arch === 'boat') return boat(B, rand, w, d);
  const above = top > 0.3;
  if (it.arch === 'skeleton') {
    B.box(-w / 2, -0.5, -d / 2, w / 2, 0.3, d / 2, KIND.concrete);
    skeleton(B, rand, w, d, 0, h, true);
    rubble(B, rand, 0, 0, Math.max(w, d) * 0.6, 0.3, 3 + Math.floor(rand() * 4));
    return;
  }
  if (it.arch === 'stepped') {
    const qs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    qs.forEach(([sx, sz], i) => {
      const hq = h * it.qf[i];
      B.box(sx < 0 ? -w / 2 : 0, 0, sz < 0 ? -d / 2 : 0, sx < 0 ? 0 : w / 2, hq, sz < 0 ? 0 : d / 2, KIND.facade);
    });
    // rubble spilling off the lowest block
    const lo = it.qf.indexOf(Math.min(...it.qf)), [sx, sz] = qs[lo];
    rubble(B, rand, sx * w / 4, sz * d / 4, Math.min(w, d) * 0.35, h * it.qf[lo], 4 + Math.floor(rand() * 5));
    rubble(B, rand, sx * w * 0.6, sz * d * 0.6, Math.min(w, d) * 0.4, 0, 4);
    return;
  }
  const hb = it.hb;
  B.box(-w / 2, 0, -d / 2, w / 2, hb, d / 2, KIND.facade);
  if (it.y + hb > 1) windowReveals(B, w, d, hb, -it.y);
  if (it.ledge) ledges(B, w, d, 0, hb, it.ledge);
  if (it.balc) balconies(B, rand, w, d, hb, it.balcSide);
  if (it.y + hb > 1) facadeClutter(B, rand, w, d, hb, -it.y);   // only what stands clear of the sea
  if (it.arch === 'collapsed') {
    skeleton(B, rand, w, d, hb, h, false);
    rubble(B, rand, (rand() - 0.5) * w * 0.4, (rand() - 0.5) * d * 0.4, Math.min(w, d) * 0.3, hb, 3 + Math.floor(rand() * 4));
    if (rand() < 0.6) rubble(B, rand, (rand() - 0.5) * w * 1.6, (rand() - 0.5) * d * 1.6, Math.min(w, d) * 0.3, 0, 4);
    return;
  }
  // intact: parapet and the clutter of an old roof
  if (above || hb > 6) parapet(B, w, d, hb);
  if (above) roofClutter(B, rand, w, d, hb);
}

// one mesh per city (cheap culling); returns an array of meshes sharing the material
export function buildRuinMeshes(items, material, frameOf, groupOf) {
  const builders = new Map();
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), o = new THREE.Vector3();
  items.forEach((it, i) => {
    const g = groupOf(it);
    if (!builders.has(g)) builders.set(g, new Builder());
    const B = builders.get(g);
    frameOf(items, i, p, q);
    B.frame(p, q, o.set(it.x, it.y, it.z));
    building(B, it, rng(it.seed));
  });
  return [...builders.values()].map((B) => {
    const mesh = new THREE.Mesh(B.geometry(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  });
}
