import * as THREE from 'three';
import { paintLivery, planUV, FUSE, WINGLET } from './gliderLivery.js';

// The glider (after art/refs/glider_sheet.png): a cream blended-delta with a needle nose,
// a tinted bubble canopy, two turbofans slung under the wing roots, chipped orange
// bands and upswept winglets. Real airfoil sections, lofted fuselage, elevons that move,
// fans that spin. Model space: nose towards +z, wings along x, metres. Span ~25 m.
export const CASTER_LAYER = 2;

// --- planform ---------------------------------------------------------------------------
const SPAN = 12.35;
const lead = (x) => 6.5 - 13.9 * x / 12.6;
const trail = (x) => (x < 3.8 ? -4.4 + x / 3.8 : -3.4 - 4.9 * (x - 3.8) / 8.3);
const HINGE = 0.78;                          // elevon hinge, fraction of chord from the LE
const ELEVON = [4.7, 10.6];
const wingY = (x) => 0.15 + 0.03 * x;        // gentle dihedral

const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// half thickness of a NACA 4-digit section at chord fraction c
const naca = (c, t) => 5 * t * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);

function wingGeometry(side) {
  const nu = 34, nc = 20, R = 2 * nc + 1;
  const pos = [], uv = [], flap = [], idx = [];
  const cs = (i) => (1 - Math.cos(Math.PI * i / nc)) / 2;
  for (let i = 0; i <= nu; i++) {
    const s = Math.pow(i / nu, 0.85), x = s * SPAN;
    const zl = lead(x), zt = trail(x), C = zl - zt;
    const tr = 0.07 - 0.035 * s;
    const w = smooth(ELEVON[0], ELEVON[0] + 0.15, x) * (1 - smooth(ELEVON[1] - 0.15, ELEVON[1], x));
    for (let k = 0; k < R; k++) {
      const top = k <= nc, c = cs(top ? nc - k : k - nc);
      const y = wingY(x) + 0.012 * C * Math.sin(Math.PI * c) + (top ? 1 : -1) * naca(c, tr) * C;
      const z = zl - c * C;
      pos.push(side * x, y, z);
      uv.push(...planUV(side * x, z));
      flap.push(Math.max(0, c - HINGE) * C * w, side);
    }
  }
  const tri = (a, b, c) => (side > 0 ? idx.push(a, b, c) : idx.push(a, c, b));
  for (let i = 0; i < nu; i++) for (let k = 0; k < R - 1; k++) {
    const a = i * R + k, b = a + R;
    tri(a, a + 1, b); tri(a + 1, b + 1, b);
  }
  // close the tip with a fan
  const base = nu * R, ci = pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < R; k++) { cx += pos[(base + k) * 3]; cy += pos[(base + k) * 3 + 1]; cz += pos[(base + k) * 3 + 2]; }
  pos.push(cx / R, cy / R, cz / R); uv.push(...planUV(cx / R, cz / R)); flap.push(0, side);
  for (let k = 0; k < R - 1; k++) tri(ci, base + k + 1, base + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- fuselage: superelliptic sections lofted nose to tail -------------------------------
// z, half width, height above / below the centre line, centre line height
const SECTIONS = [
  [-10.4, 0.04, 0.04, 0.04, 0.36], [-9.6, 0.2, 0.16, 0.13, 0.36], [-8.5, 0.42, 0.32, 0.25, 0.35],
  [-6.5, 0.72, 0.48, 0.4, 0.36], [-4, 1.0, 0.62, 0.5, 0.38], [-1.5, 1.15, 0.76, 0.55, 0.4],
  [1, 1.2, 0.9, 0.55, 0.42], [3, 1.15, 0.98, 0.55, 0.44], [5, 1.03, 0.92, 0.53, 0.45],
  [7, 0.84, 0.74, 0.48, 0.45], [9, 0.52, 0.46, 0.34, 0.42], [10.5, 0.24, 0.21, 0.17, 0.39], [11.6, 0.03, 0.03, 0.03, 0.37],
];

function section(z) {
  const S = SECTIONS;
  let i = 0;
  while (i < S.length - 2 && S[i + 1][0] < z) i++;
  const p0 = S[Math.max(0, i - 1)], p1 = S[i], p2 = S[i + 1], p3 = S[Math.min(S.length - 1, i + 2)];
  const t = (z - p1[0]) / (p2[0] - p1[0]);
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3);
  return [1, 2, 3, 4].map((k) => cr(p0[k], p1[k], p2[k], p3[k]));
}

function fuselageGeometry() {
  const nz = 70, N = 40, E = 2 / 2.6;
  const z0 = SECTIONS[0][0], z1 = SECTIONS.at(-1)[0];
  const rings = [];
  let halfArc = 0;
  for (let i = 0; i <= nz; i++) {
    const z = z0 + (z1 - z0) * (i / nz);
    const [w, ht, hb, y0] = section(z);
    const ring = [];
    for (let j = 0; j <= N; j++) {
      const th = -Math.PI / 2 + (2 * Math.PI * j) / N, c = Math.cos(th), s = Math.sin(th);
      ring.push(new THREE.Vector3(w * Math.sign(c) * Math.abs(c) ** E, y0 + (s > 0 ? ht : hb) * Math.sign(s) * Math.abs(s) ** E, z));
    }
    // arc length from the top line, signed (+x side positive)
    const acc = [0];
    for (let j = 1; j <= N; j++) acc.push(acc[j - 1] + ring[j].distanceTo(ring[j - 1]));
    const top = acc[N / 2];
    rings.push({ ring, arc: acc.map((a) => top - a) });
    halfArc = Math.max(halfArc, top);
  }
  const ka = Math.min(0.7, 2.3 / halfArc);
  const pos = [], uv = [], idx = [];
  for (const { ring, arc } of rings) ring.forEach((p, j) => {
    pos.push(p.x, p.y, p.z);
    uv.push(...planUV(FUSE.u0 + arc[j] * ka, FUSE.v0 + p.z * FUSE.kz));
  });
  for (let i = 0; i < nz; i++) for (let j = 0; j < N; j++) {
    const a = i * (N + 1) + j, b = a + N + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, ka, halfArc };
}

// --- canopy -----------------------------------------------------------------------------
const CANOPY = [[0, 2.5], [0.6, 2.9], [0.9, 3.6], [1.0, 4.6], [0.92, 5.6], [0.7, 6.6], [0.36, 7.4], [0, 7.85]];
const CANOPY_Y = 1.1, CANOPY_W = 0.68, CANOPY_H = 0.72;
function canopyR(z) {
  for (let i = 0; i < CANOPY.length - 1; i++) {
    const [r0, z0] = CANOPY[i], [r1, z1] = CANOPY[i + 1];
    if (z >= z0 && z <= z1) return r0 + (r1 - r0) * (z - z0) / (z1 - z0);
  }
  return 0;
}

// --- engines ----------------------------------------------------------------------------
function engine(mats) {
  const pod = new THREE.Group();
  const prof = [[0.6, -2.4], [0.7, -2.0], [0.8, -1.0], [0.84, 0.2], [0.84, 1.4], [0.82, 2.0], [0.76, 2.32], [0.68, 2.42], [0.62, 2.34], [0.6, 2.1]];
  const shellGeo = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 40).rotateX(Math.PI / 2);
  // heat tint of titanium towards the exhaust: straw, gold, a violet-blue band, then grey
  const p = shellGeo.attributes.position, col = [];
  const c = new THREE.Color();
  const straw = new THREE.Color(0.95, 0.84, 0.62), gold = new THREE.Color(0.98, 0.62, 0.24), violet = new THREE.Color(0.58, 0.36, 0.88), blue = new THREE.Color(0.32, 0.55, 1.0), grey = new THREE.Color(0.55, 0.55, 0.6);
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i), a = Math.atan2(p.getY(i), p.getX(i));
    const w = 0.12 * Math.sin(a * 3 + 1.0) + 0.08 * Math.sin(a * 7);   // uneven, like real bluing
    c.setRGB(1, 1, 1).lerp(straw, smooth(-0.3, -0.9, z + w)).lerp(gold, smooth(-0.9, -1.3, z + w))
      .lerp(violet, smooth(-1.3, -1.6, z + w)).lerp(blue, smooth(-1.6, -1.9, z + w)).lerp(grey, smooth(-1.95, -2.35, z));
    col.push(c.r, c.g, c.b);
  }
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pod.add(new THREE.Mesh(shellGeo, mats.metal));
  // the polished intake lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.075, 12, 48), mats.chrome);
  lip.position.z = 2.36;
  pod.add(lip);
  // A recessed inner rim gives the intake a visible thickness against the dark duct.
  const innerRim = new THREE.Mesh(new THREE.TorusGeometry(0.59, 0.025, 8, 40), mats.blade);
  innerRim.position.z = 2.22;
  pod.add(innerRim);
  // intake duct and fan
  const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.7, 32, 1, true).rotateX(Math.PI / 2), mats.duct);
  duct.position.z = 1.8;
  pod.add(duct);
  const fan = new THREE.Group();
  const blades = [];
  for (let k = 0; k < 16; k++) {
    const b = new THREE.BoxGeometry(0.11, 0.43, 0.045);
    // Swept, tapered blades catch the light individually as the fan turns.
    const bp = b.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i), taper = y > 0 ? 0.55 : 1;
      bp.setX(i, bp.getX(i) * taper + y * 0.23);
    }
    b.computeVertexNormals();
    b.rotateY(0.4).translate(0, 0.36, 0).rotateZ((k / 16) * Math.PI * 2);
    blades.push(b);
  }
  const bladeGeo = blades.reduce((acc, b) => (acc ? mergeInto(acc, b) : b), null);
  fan.add(new THREE.Mesh(bladeGeo, mats.blade));
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 24).rotateX(Math.PI / 2), mats.metal);
  hub.position.z = 0.16;
  fan.add(hub);
  fan.position.z = 1.55;
  pod.add(fan);
  // nozzle petals around a centre plug, glowing inside
  const petalGeometries = [];
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.6), mats.duct);
    petal.position.set(Math.cos(a) * 0.56, Math.sin(a) * 0.56, -2.62);
    petal.rotation.set(0, 0, a + Math.PI / 2, 'ZYX');
    petal.rotateX(-0.16);
    petal.updateMatrix();
    petalGeometries.push(petal.geometry.applyMatrix4(petal.matrix));
  }
  const petals = new THREE.Mesh(petalGeometries.reduce((a, b) => a ? mergeInto(a, b) : b, null), mats.duct);
  pod.add(petals);
  const nozzleRim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 8, 40), mats.blade);
  nozzleRim.position.z = -2.43;
  pod.add(nozzleRim);
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 24).rotateX(-Math.PI / 2), mats.duct);
  plug.position.z = -2.75;
  pod.add(plug);
  // the turbine seen through the nozzle: stator vanes over a hot core
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.58, 40), mats.turbine);
  glow.rotation.y = Math.PI;
  glow.position.z = -2.3;
  pod.add(glow);
  // exhaust: a faint hot cone that wavers (reads as heat haze over the sea)
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.5, 9, 24, 1, true).translate(0, -4.5, 0).rotateX(Math.PI / 2), mats.plume);
  plume.position.z = -2.75;
  plume.renderOrder = 2;
  pod.add(plume);
  return { pod, fan, glow, plume, lip, petals };
}

const TURBINE_FRAG = /* glsl */`
uniform float uHeat;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0, a = atan(d.y, d.x);
  float vanes = smoothstep(0.2, 0.6, abs(sin(a * 11.0 + r * 2.0)));
  vec3 hot = vec3(1.0, 0.42, 0.12) * (0.25 + 3.0 * uHeat) * pow(max(1.0 - r, 0.0), 1.4);
  vec3 col = mix(vec3(0.03), hot, mix(0.35, 1.0, vanes)) + vec3(1.0, 0.75, 0.45) * smoothstep(0.25, 0.0, r) * uHeat * 2.0;
  gl_FragColor = vec4(col, 1.0);
}`;
const PLUME_FRAG = /* glsl */`
uniform float uHeat, uTime;
varying vec2 vUv;
varying vec3 vN, vV;
void main() {
  float along = 1.0 - vUv.y;                    // 0 at the nozzle
  float facing = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
  float flick = 0.75 + 0.25 * sin(along * 26.0 - uTime * 38.0 + vUv.x * 31.4) * sin(along * 9.0 - uTime * 17.0);
  // clamped: at the far rim 1 - along interpolates a hair below 0, and pow() of that is NaN (black dots)
  float a = facing * pow(clamp(1.0 - along, 0.0, 1.0), 2.2) * flick * (0.12 + 0.5 * uHeat);
  vec3 col = mix(vec3(1.0, 0.55, 0.25), vec3(0.75, 0.85, 1.0), smoothstep(0.0, 0.35, along));
  gl_FragColor = vec4(col * a, 1.0);
}`;
const FX_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN, vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
function engineFx() {
  const u = { uHeat: { value: 0 }, uTime: { value: 0 } };
  return {
    uniforms: u,
    turbine: new THREE.ShaderMaterial({ uniforms: u, vertexShader: FX_VERT, fragmentShader: TURBINE_FRAG }),
    plume: new THREE.ShaderMaterial({ uniforms: u, vertexShader: FX_VERT, fragmentShader: PLUME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  };
}

function mergeInto(a, b) {
  // tiny merge for same-attribute indexed boxes
  const pa = a.attributes, pb = b.attributes, off = pa.position.count;
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv']) {
    const arr = new Float32Array(pa[k].array.length + pb[k].array.length);
    arr.set(pa[k].array); arr.set(pb[k].array, pa[k].array.length);
    g.setAttribute(k, new THREE.BufferAttribute(arr, pa[k].itemSize));
  }
  g.setIndex([...a.index.array, ...Array.from(b.index.array, (i) => i + off)]);
  return g;
}

// --- winglets ---------------------------------------------------------------------------
function wingletGeometry() {
  const s = new THREE.Shape([[-7.15, 0], [-8.05, 1.6], [-8.6, 1.66], [-8.45, 0]].map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2 });
  g.translate(0, 0, -0.025);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, ...planUV(WINGLET.u0 + p.getY(i) * WINGLET.ku, WINGLET.v0 + (p.getX(i) - WINGLET.z0) * WINGLET.kv));
  g.rotateY(-Math.PI / 2);    // shape x -> world z, extrusion -> world x
  g.computeVertexNormals();
  return g;
}

// --- materials --------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
function tex(file, srgb, repeat = [1, 1]) {
  const t = loader.load(`/textures/${file}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function hullMaterial(livery, elevon) {
  const m = new THREE.MeshPhysicalMaterial({
    map: livery.map, normalMap: livery.normalMap, roughnessMap: livery.ormMap, metalnessMap: livery.ormMap,
    roughness: 1, metalness: 1, normalScale: new THREE.Vector2(0.9, 0.9),
    clearcoat: 0.28, clearcoatRoughness: 0.4, envMapIntensity: 1.0,
    diffuseRoughness: 0.45,   // EON (three r187): chalky aged paint under the clearcoat
  });
  const wear = tex('glider_wear_nr.png', false);
  m.onBeforeCompile = (s) => {
    s.uniforms.uElevon = elevon;
    s.uniforms.uWear = { value: wear };
    s.vertexShader = s.vertexShader
      .replace('void main() {', 'attribute vec2 aFlap;\nuniform vec2 uElevon;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y -= aFlap.x * (aFlap.y < 0.0 ? uElevon.x : uElevon.y);');
    s.fragmentShader = s.fragmentShader
      .replace('void main() {', 'uniform sampler2D uWear;\nvoid main() {')
      // fine scratches and orange peel from a real painted-metal scan (ambientCG, CC0)
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale;\n  mapN.xy += (texture2D(uWear, vNormalMapUv * 13.0).xy * 2.0 - 1.0) * 0.35;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor * (0.72 + 0.56 * texture2D(uWear, vRoughnessMapUv * 13.0).b), 0.05, 1.0);');
  };
  m.customProgramCacheKey = () => 'glider-hull';
  return m;
}

function metalMaterial() {
  // Metal009 (ambientCG, CC0): colour + packed normal xy / roughness
  const nr = tex('glider_metal_nr.png', false, [4, 2]);
  const m = new THREE.MeshStandardMaterial({
    map: tex('glider_metal_color.jpg', true, [4, 2]), normalMap: nr, roughnessMap: nr,
    color: 0xe2e0da, metalness: 0.85, roughness: 1, vertexColors: true, envMapIntensity: 1.3,
  });
  m.defines = { USE_PACKED_NORMALMAP: '' };
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('roughnessFactor *= texelRoughness.g;', 'roughnessFactor *= texelRoughness.b * 0.6 + 0.08;');
  };
  m.customProgramCacheKey = () => 'glider-metal';
  return m;
}

export function createGlider() {
  const root = new THREE.Group();
  const body = new THREE.Group();   // banks and pitches inside root
  root.add(body);

  const fuse = fuselageGeometry();
  const livery = paintLivery({ lead, trail, span: SPAN, hingeC: HINGE, elevon: ELEVON }, fuse);
  const elevon = { value: new THREE.Vector2() };
  const hull = hullMaterial(livery, elevon);
  const mats = {
    metal: metalMaterial(),
    duct: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.55, metalness: 0.7, side: THREE.DoubleSide }),
    blade: new THREE.MeshStandardMaterial({ color: 0x8d9094, roughness: 0.3, metalness: 1 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.12, metalness: 1, envMapIntensity: 1.6 }),
  };
  const fx = engineFx();
  Object.assign(mats, { turbine: fx.turbine, plume: fx.plume });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x324953, metalness: 0.12, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.035,
    ior: 1.48, envMapIntensity: 2.1,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.45, metalness: 0.7 });

  for (const side of [-1, 1]) body.add(new THREE.Mesh(wingGeometry(side), hull));
  body.add(new THREE.Mesh(fuse.geometry, hull));

  // canopy and its frame
  const canopy = new THREE.Mesh(new THREE.LatheGeometry(CANOPY.map(([r, z]) => new THREE.Vector2(r, z)), 40).rotateX(Math.PI / 2), glass);
  canopy.scale.set(CANOPY_W, CANOPY_H, 1);
  canopy.position.y = CANOPY_Y;
  body.add(canopy);
  // A dark gasket grounds the transparent-looking shell against the fuselage.
  const sealMat = new THREE.MeshStandardMaterial({ color: 0x202a2b, roughness: 0.68, metalness: 0.12 });
  for (const side of [-1, 1]) {
    const points = [];
    for (let z = 2.65; z <= 7.7; z += 0.18) points.push(new THREE.Vector3(side * CANOPY_W * canopyR(z), CANOPY_Y, z));
    body.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 32, 0.035, 5), sealMat));
  }
  for (const z of [3.3, 4.7, 6.1]) {
    const r = canopyR(z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.045 / r, 6, 28, Math.PI), frameMat);
    ring.scale.set(CANOPY_W * r * 1.01, CANOPY_H * r * 1.01, r);
    ring.position.set(0, CANOPY_Y, z);
    body.add(ring);
  }
  const rail = (f) => {
    const pts = [];
    for (let z = 2.65; z <= 7.7; z += 0.25) pts.push(f(z, canopyR(z)));
    return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.04, 6), frameMat);
  };
  body.add(rail((z, r) => new THREE.Vector3(0, CANOPY_Y + CANOPY_H * r + 0.01, z)));
  for (const s of [-1, 1]) body.add(rail((z, r) => new THREE.Vector3(s * CANOPY_W * r, CANOPY_Y + 0.02, z)));

  // engines under the wing roots, sticking out past the trailing edge
  const engines = [];
  for (const side of [-1, 1]) {
    const e = engine(mats);
    e.pod.position.set(side * 2.55, -0.42, -4.6);
    body.add(e.pod);
    engines.push(e);
  }

  // Invisible contact anchors inherit the complete body and root transforms.
  const wingTips = [-1, 1].map((side) => {
    const tip = new THREE.Object3D();
    tip.position.set(side * SPAN, wingY(SPAN) - 0.02, (lead(SPAN) + trail(SPAN)) * 0.5);
    body.add(tip);
    return tip;
  });

  // winglets, canted out
  const wlGeo = wingletGeometry();
  for (const side of [-1, 1]) {
    const wl = new THREE.Mesh(wlGeo, hull);
    wl.position.set(side * (SPAN - 0.05), wingY(SPAN), 0);
    wl.rotation.z = -side * 0.32;
    body.add(wl);
  }

  // pitot, tail spike, dorsal antenna
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.3, metalness: 1 });
  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.032, 1.1, 8).rotateX(Math.PI / 2), steel);
  pitot.position.set(0, 0.37, 12.1);
  body.add(pitot);
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 1.4, 8).rotateX(-Math.PI / 2), steel);
  spike.position.set(0, 0.36, -11.0);
  body.add(spike);
  const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.32, 0.3).translate(0, 0.16, 0), frameMat);
  antenna.position.set(0, 1.12, -1.2);
  antenna.rotation.x = -0.35;
  body.add(antenna);

  // navigation lights (red port, green starboard, white tail strobe)
  const light = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  const tipY = wingY(SPAN);
  const nav = [light(new THREE.Color(4, 0.2, 0.15), SPAN - 0.1, tipY, lead(SPAN) - 0.15),
    light(new THREE.Color(0.2, 4, 0.6), -SPAN + 0.1, tipY, lead(SPAN) - 0.15),
    light(new THREE.Color(4, 4, 4), 0, 0.42, -10.5)];

  body.traverse((o) => { if (o.isMesh) o.layers.enable(CASTER_LAYER); });
  // thin rings stay out of the floater shadow map: the hollow ring of nozzle petals cast dotted dark
  // circles on the sea and its light shafts (and the lip and plume add nothing to the shadow)
  for (const e of engines) for (const o of [e.plume, e.lip, e.petals]) o.layers.disable(CASTER_LAYER);

  let t = 0, prevBank = 0, prevPitch = 0;
  return {
    root, body, wingTips,
    radius: 13,
    update(dt, throttle, flight, enginePower = 1) {
      t += dt;
      for (const e of engines) {
        e.fan.rotation.z += dt * (9 + 45 * throttle) * enginePower;
        e.plume.visible = enginePower > 0;
        e.glow.visible = enginePower > 0;
      }
      fx.uniforms.uTime.value = t;
      fx.uniforms.uHeat.value = throttle * enginePower * (0.97 + 0.03 * Math.sin(t * 37));
      nav[0].visible = nav[1].visible = Math.sin(t * 1.4) > -0.6;
      nav[2].visible = (t % 2.4) < 0.08;
      if (flight && dt > 0) {
        // elevons: roll rate differentially, pitch rate together (TE up to climb)
        const rollRate = (flight.bank - prevBank) / dt, pitchRate = (flight.pitch - prevPitch) / dt;
        prevBank = flight.bank; prevPitch = flight.pitch;
        const roll = THREE.MathUtils.clamp(rollRate * 0.9, -0.3, 0.3);
        const pitch = THREE.MathUtils.clamp(-pitchRate * 1.2 - flight.pitch * 0.4, -0.25, 0.25);
        const k = 1 - Math.exp(-8 * dt);
        elevon.value.x += (pitch - roll - elevon.value.x) * k;   // -x side
        elevon.value.y += (pitch + roll - elevon.value.y) * k;   // +x side
      }
    },
  };
}
