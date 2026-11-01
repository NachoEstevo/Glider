import * as THREE from 'three';

// The glider's paint, painted once on canvases: colour, height (seams, rivets, hatches,
// turned into a normal map) and occlusion/roughness/metalness. Everything is laid out in
// planform metres seen from above (the wing UVs), with the empty corners of the sheet
// holding the fuselage (unrolled around its cross-section) and the winglets.
export const EXT = 26;                      // metres covered by the sheet
const S = 2048;

// where things live on the sheet (metres)
export const FUSE = { u0: -10.6, v0: 5.0, kz: 0.68 };          // + arc * ka (set by the model)
export const WINGLET = { u0: 9.5, ku: 1.5, v0: 8, kv: 1.5, z0: -7.7 };

export const planUV = (x, z) => [x / EXT + 0.5, z / EXT + 0.5];

function rng(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const CREAM = [226, 217, 197];

function sheet(fill) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = fill;
  g.fillRect(0, 0, S, S);
  g.setTransform(S / EXT, 0, 0, -S / EXT, S / 2, S / 2);   // draw in metres, +z up the sheet
  return g;
}

// the three layers draw the same shapes; one painter calls into all of them
function layers() {
  const C = sheet(`rgb(${CREAM})`), H = sheet('rgb(128,128,128)'), O = sheet('rgb(255,150,12)');
  const all = [C, H, O];
  return {
    C, H, O,
    each(fn) { for (const g of all) { g.save(); fn(g); g.restore(); } },
    // change the frame of all three (no save/restore)
    apply(fn) { for (const g of all) fn(g); },
  };
}

// a panelled area in a local frame: rows across t, panels along s
function panels(L, rand, { s0, s1, t0, t1, row = [1.5, 2.3], len = [2.8, 5.2], spare = 0.025, rv = 1 }) {
  for (let t = t0; t < t1;) {
    const h = row[0] + rand() * (row[1] - row[0]);
    let s = s0 - rand() * len[1];
    while (s < s1) {
      const w = len[0] + rand() * (len[1] - len[0]);
      // each plate a slightly different batch of paint; a few replaced with bare grey ones
      const r = rand();
      const j = (rand() - 0.5) * 7;
      const fill = r < spare ? `rgb(${186 + j},${184 + j},${176 + j})` : r < spare * 2 ? `rgb(${214 + j},${202 + j},${178 + j})` : `rgb(${CREAM[0] + j},${CREAM[1] + j},${CREAM[2] + j * 1.2})`;
      L.C.fillStyle = fill;
      L.C.fillRect(s, t, w, h);
      if (r < spare) { L.O.fillStyle = 'rgb(255,120,150)'; L.O.fillRect(s, t, w, h); }
      // seams engraved, with rivet lines just inside
      L.C.strokeStyle = 'rgba(58,50,38,0.16)'; L.C.lineWidth = 0.02; L.C.strokeRect(s, t, w, h);
      L.H.strokeStyle = 'rgb(85,85,85)'; L.H.lineWidth = 0.03; L.H.strokeRect(s, t, w, h);
      L.O.strokeStyle = 'rgb(200,215,12)'; L.O.lineWidth = 0.035; L.O.strokeRect(s, t, w, h);
      rivets(L, s + 0.06, t + 0.06, w - 0.12, h - 0.12, rv);
      s += w;
    }
    t += h;
  }
}

function rivets(L, x, y, w, h, k = 1) {
  const step = 0.27 * k;
  L.C.fillStyle = 'rgba(70,62,50,0.12)';
  L.H.fillStyle = 'rgb(175,175,175)';
  const a = 0.013 * k, b = 0.016 * k;
  const dot = (px, py) => { L.C.fillRect(px - a, py - a, 2 * a, 2 * a); L.H.fillRect(px - b, py - b, 2 * b, 2 * b); };
  for (let a = 0; a <= w; a += step) { dot(x + a, y); dot(x + a, y + h); }
  for (let a = step; a < h; a += step) { dot(x, y + a); dot(x + w, y + a); }
}

function hatch(L, x, y, w, h, grey = false) {
  if (grey) { L.C.fillStyle = 'rgb(176,175,168)'; L.C.fillRect(x, y, w, h); L.O.fillStyle = 'rgb(255,110,170)'; L.O.fillRect(x, y, w, h); }
  L.C.strokeStyle = 'rgba(48,42,32,0.6)'; L.C.lineWidth = 0.028; L.C.strokeRect(x, y, w, h);
  L.H.strokeStyle = 'rgb(40,40,40)'; L.H.lineWidth = 0.04; L.H.strokeRect(x, y, w, h);
  // latches
  L.C.fillStyle = 'rgba(40,36,30,0.6)';
  L.C.fillRect(x + w * 0.2, y + h - 0.05, 0.08, 0.035); L.C.fillRect(x + w * 0.7, y + h - 0.05, 0.08, 0.035);
}

// worn paint: a band with chipped edges (chips show primer or bare aluminium)
function band(L, rand, pts, colour = [201, 112, 58]) {
  const path = (g) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.closePath(); };
  path(L.C); L.C.fillStyle = `rgb(${colour})`; L.C.fill();
  path(L.O); L.O.fillStyle = 'rgb(255,165,10)'; L.O.fill();
  // fade and dirt inside the band
  L.C.save(); path(L.C); L.C.clip();
  for (let i = 0; i < 160; i++) {
    const p = pts[Math.floor(rand() * pts.length)], q = pts[Math.floor(rand() * pts.length)];
    const k = rand(), x = p[0] + (q[0] - p[0]) * k, y = p[1] + (q[1] - p[1]) * k, r = 0.1 + rand() * 0.6;
    const grd = L.C.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rand() < 0.5 ? 'rgba(236,200,160,0.35)' : 'rgba(110,70,40,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    L.C.fillStyle = grd; L.C.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  L.C.restore();
  // chips along the band
  for (let i = 0; i < 110; i++) {
    const a = pts[Math.floor(rand() * pts.length)], b = pts[(pts.indexOf(a) + 1) % pts.length];
    const k = rand(), x = a[0] + (b[0] - a[0]) * k + (rand() - 0.5) * 0.25, y = a[1] + (b[1] - a[1]) * k + (rand() - 0.5) * 0.25;
    chip(L, rand, x, y, 0.015 + rand() * 0.055, rand() < 0.35);
  }
}

function chip(L, rand, x, y, r, bare) {
  const shape = (g) => {
    g.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, rr = r * (0.5 + rand() * 0.8);
      g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7);
    }
    g.closePath();
  };
  shape(L.C); L.C.fillStyle = bare ? 'rgb(150,150,146)' : `rgb(${CREAM[0] - 6},${CREAM[1] - 6},${CREAM[2] - 8})`; L.C.fill();
  if (bare) { shape(L.O); L.O.fillStyle = 'rgb(255,95,235)'; L.O.fill(); }
  shape(L.H); L.H.fillStyle = 'rgb(110,110,110)'; L.H.fill();
}

// flip: drawn inside a mirrored frame, so mirror the letters back
function stencil(L, text, x, y, size, angle = 0, alpha = 0.55, flip = false) {
  const g = L.C;
  g.save();
  g.translate(x, y); g.scale(flip ? -1 : 1, -1); g.rotate(flip ? -angle : angle);  g.font = `600 ${size}px "IBM Plex Mono", monospace`;
  g.fillStyle = `rgba(52,48,42,${alpha})`;
  g.fillText(text, 0, 0);
  g.restore();
}

function grime(L, rand, n, area) {
  // streaks running aft (-z) from seams and hatches, and broad weathering blotches
  for (let i = 0; i < n; i++) {
    const x = area.x0 + rand() * (area.x1 - area.x0), z = area.z0 + rand() * (area.z1 - area.z0);
    L.C.strokeStyle = `rgba(92,78,58,${0.03 + rand() * 0.07})`;
    L.C.lineWidth = 0.02 + rand() * 0.07;
    L.C.beginPath(); L.C.moveTo(x, z); L.C.lineTo(x + (rand() - 0.5) * 0.05, z - 0.4 - rand() * 2.4); L.C.stroke();
  }
  for (let i = 0; i < n * 0.6; i++) {
    const x = area.x0 + rand() * (area.x1 - area.x0), z = area.z0 + rand() * (area.z1 - area.z0), r = 0.4 + rand() * 2.2;
    const grd = L.C.createRadialGradient(x, z, 0, x, z, r);
    const light = rand() < 0.4;
    grd.addColorStop(0, light ? 'rgba(250,246,232,0.10)' : 'rgba(110,96,74,0.07)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    L.C.fillStyle = grd; L.C.fillRect(x - r, z - r, 2 * r, 2 * r);
    if (!light) {   // dirt is a little rougher
      const g2 = L.O.createRadialGradient(x, z, 0, x, z, r);
      g2.addColorStop(0, 'rgba(255,190,12,0.25)'); g2.addColorStop(1, 'rgba(255,190,12,0)');
      L.O.fillStyle = g2; L.O.fillRect(x - r, z - r, 2 * r, 2 * r);
    }
  }
}

function soot(L, x, z, rx, rz, a = 0.5) {
  const g = L.C;
  g.save(); g.translate(x, z); g.scale(rx, rz);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  grd.addColorStop(0, `rgba(36,30,26,${a})`); grd.addColorStop(1, 'rgba(36,30,26,0)');
  g.fillStyle = grd; g.fillRect(-1, -1, 2, 2);
  g.restore();
}

function toNormal(H, strength) {
  const src = H.getImageData(0, 0, S, S).data;
  const out = new ImageData(S, S), d = out.data;
  const h = (x, y) => src[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (h(x + 1, y) - h(x - 1, y)) * strength, dy = (h(x, y - 1) - h(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (-dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.getContext('2d').putImageData(out, 0, 0);
  return c;
}

function texture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// wing: planform geometry (shared with the model), fuselage: half perimeter in metres
export function paintLivery(wing, fuse) {
  const rand = rng(77);
  const L = layers();
  const { lead, trail, span, hingeC, elevon } = wing;

  // --- wings, both sides (mirrored frame, own random plates) ---
  for (const side of [1, -1]) {
    L.apply((g) => g.scale(side, 1));
    // frame along the leading edge: s outboard along it, t aft into the wing
    const ax = span / Math.hypot(span, lead(0) - lead(span)), az = (lead(span) - lead(0)) / Math.hypot(span, lead(0) - lead(span));
    for (const g of [L.C, L.H, L.O]) { g.save(); g.transform(ax, az, az, -ax, 0, lead(0)); }
    panels(L, rand, { s0: 0, s1: 20, t0: 0, t1: 12 });
    for (const g of [L.C, L.H, L.O]) g.restore();

    // control surfaces: hinge line and side cuts of the elevon
    const hz = (x) => lead(x) - hingeC * (lead(x) - trail(x));
    L.each((g) => {
      g.lineWidth = 0.04;
      g.strokeStyle = g === L.C ? 'rgba(40,34,26,0.7)' : g === L.H ? 'rgb(30,30,30)' : 'rgb(255,220,12)';
      g.beginPath();
      g.moveTo(elevon[0], trail(elevon[0])); g.lineTo(elevon[0], hz(elevon[0])); g.lineTo(elevon[1], hz(elevon[1])); g.lineTo(elevon[1], trail(elevon[1]));
      g.stroke();
    });
    // hatches near the root, grey service panels like the reference sheet
    hatch(L, 3.1, -1.6, 0.9, 1.6, true);
    hatch(L, 4.6, -2.6, 0.7, 0.5);
    hatch(L, 2.2, 1.6, 0.6, 0.9);
    hatch(L, 6.8, -3.1, 1.1, 0.45);
    // walkway marks and stencils
    L.C.strokeStyle = 'rgba(60,54,44,0.4)'; L.C.lineWidth = 0.035; L.C.setLineDash([0.18, 0.12]);
    L.C.beginPath(); L.C.moveTo(1.4, 1.0); L.C.lineTo(3.4, -2.6); L.C.stroke(); L.C.setLineDash([]);
    stencil(L, 'NO STEP', 4.2, -0.4, 0.2, -0.5, 0.55, side < 0);

    // orange: chipped band behind the outer leading edge and a patch on the tip
    const pts = [];
    for (let x = 3.4; x <= 10.4; x += 0.35) pts.push([x, lead(x) - 0.12]);
    for (let x = 10.4; x >= 3.4; x -= 0.35) pts.push([x, lead(x) - 0.12 - 0.75 - 0.05 * Math.sin(x * 3)]);
    band(L, rand, pts);
    const tip = [];
    for (let x = 10.9; x <= span; x += 0.2) tip.push([x, lead(x) - 0.08]);
    tip.push([span, trail(span)], [11.4, trail(11.4) + 0.05], [10.9, trail(10.9) + 0.4]);
    band(L, rand, tip);

    // bare metal along the leading edge, worn by rain and sand
    for (let i = 0; i < 160; i++) {
      const x = 1 + rand() * (span - 1);
      chip(L, rand, x, lead(x) - 0.04 - rand() * 0.18, 0.015 + rand() * 0.05, rand() < 0.7);
    }
    L.apply((g) => g.scale(side, 1));
  }
  grime(L, rand, 260, { x0: -13, x1: 13, z0: -9, z1: 7 });
  // exhaust soot behind the engines, on the wing roots aft and the trailing edge
  for (const s of [-1, 1]) soot(L, s * 2.55, -7.4, 1.3, 1.4, 0.35);

  // --- fuselage, unrolled: (arc, z) -> sheet ---
  const ka = fuse.ka;
  L.apply((g) => g.transform(ka, 0, 0, FUSE.kz, FUSE.u0, FUSE.v0));
  const half = fuse.halfArc;
  L.C.fillStyle = `rgb(${CREAM})`; L.C.fillRect(-half, -11.5, 2 * half, 24);
  panels(L, rand, { s0: -half, s1: half, t0: -11.5, t1: 12.2, row: [1.5, 2.4], len: [1.0, 1.8], spare: 0.025, rv: 0.4 });
  // canopy rail vents and the access hatch behind it
  for (const s of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      L.C.fillStyle = 'rgba(30,28,26,0.85)'; L.C.fillRect(s * 1.05 - 0.04, 1.6 + k * 0.16, 0.08 * s, 0.1);
      L.H.fillStyle = 'rgb(50,50,50)'; L.H.fillRect(s * 1.05 - 0.04, 1.6 + k * 0.16, 0.08 * s, 0.1);
    }
    stencil(L, 'GL-07', s * 1.25 - (s < 0 ? 0.55 : 0), -2.5, 0.32, 0, 0.6);
    stencil(L, 'RESCUE', s * 1.0 - (s < 0 ? 0.4 : 0), 7.6, 0.11, 0, 0.5);
    soot(L, s * 0.9, -8.8, 0.9, 2.2, 0.45);
  }
  hatch(L, -0.35, 0.4, 0.7, 1.0);
  grime(L, rand, 100, { x0: -half, x1: half, z0: -11, z1: 11 });
  L.apply((g) => g.setTransform(S / EXT, 0, 0, -S / EXT, S / 2, S / 2));

  // --- winglets (their own little patch) ---
  const W = WINGLET, wp = (y, z) => [W.u0 + y * W.ku, W.v0 + (z - W.z0) * W.kv];
  L.C.fillStyle = `rgb(${CREAM})`; L.C.fillRect(W.u0 - 0.2, W.v0 - 2, 3.5, 4.5);
  const lePts = [wp(0, -7.1), wp(1.66, -8.0), wp(1.66, -8.3), wp(0, -7.5)];
  band(L, rand, lePts);
  grime(L, rand, 30, { x0: W.u0, x1: W.u0 + 2.6, z0: W.v0 - 1.6, z1: W.v0 + 1.8 });

  const nrm = toNormal(L.H, 3.5);
  return { map: texture(L.C.canvas, true), normalMap: texture(nrm, false), ormMap: texture(L.O.canvas, false) };
}
