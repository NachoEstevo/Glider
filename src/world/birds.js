import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CASTER_LAYER } from '../glider/gliderModel.js';

// Herring-type gulls. Each wing is two cambered strips (arm and hand) on real pivots
// animated on the CPU, so the wrist folds on the upstroke, the wings hold the gull's "M"
// when gliding, and the shadows flap too. A loose company rides along under the glider;
// small flocks circle in thermals around the world.

// --- geometry ---------------------------------------------------------------------------

// a wing strip along +x: u spans the strip, v runs trailing (0) -> leading (1) edge.
// UVs land in the top half of the plumage atlas (the shader reads the underside half).
function wingStrip(span, lead, trail, seg, nu = 10, nv = 5) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, zl = lead(u), zt = trail(u), chord = zl - zt;
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      // arched section, thicker at the root
      pos.push(u * span, chord * 0.09 * Math.sin(Math.PI * Math.pow(v, 0.7)) * (1 - 0.6 * u), zt + v * chord);
      uv.push((seg + u) * 0.5, 0.5 + 0.5 * v);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);   // faces up (+y)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mirrored(g) {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const idx = m.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  m.computeVertexNormals();
  return m;
}

const ARM = 0.3, HAND = 0.4;
const armGeo = wingStrip(ARM, (u) => 0.1 - 0.012 * u, (u) => -0.15 + 0.025 * u, 0);
const handGeo = wingStrip(HAND, (u) => 0.088 - 0.19 * Math.pow(u, 1.6), (u) => -0.125 + 0.03 * u, 1, 12, 5);
const WINGS = { arm: [mirrored(armGeo), armGeo], hand: [mirrored(handGeo), handGeo] };

function colored(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal, col = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const WHITE = new THREE.Color(0.93, 0.93, 0.91), MANTLE = new THREE.Color(0.42, 0.47, 0.52);

function bodyGeometry() {
  const prof = [[0, -0.3], [0.02, -0.27], [0.042, -0.2], [0.062, -0.1], [0.07, -0.01], [0.066, 0.07], [0.05, 0.14], [0.038, 0.18], [0, 0.2]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(prof, 14).rotateX(Math.PI / 2).scale(1, 0.85, 1);
  colored(body, (c, x, y, z, ny) => c.copy(WHITE).lerp(MANTLE, ny > 0.35 && z < 0.1 && z > -0.24 ? 1 : 0));
  const head = new THREE.SphereGeometry(0.044, 12, 9).scale(0.95, 0.95, 1.25).translate(0, 0.03, 0.215);
  colored(head, (c) => c.copy(WHITE));
  const beak = new THREE.ConeGeometry(0.012, 0.075, 6).scale(0.8, 1, 1.3).rotateX(Math.PI / 2).rotateX(0.1).translate(0, 0.022, 0.29);
  colored(beak, (c, x, y, z) => c.setRGB(0.93, 0.76, 0.2).lerp(new THREE.Color(0.8, 0.15, 0.08), z > 0.3 && y < 0.024 ? 0.7 : 0));
  const eyes = mergeGeometries([-1, 1].map((s) => new THREE.SphereGeometry(0.009, 6, 4).translate(s * 0.03, 0.045, 0.24)));
  colored(eyes, (c) => c.setRGB(0.02, 0.02, 0.02));
  // fanned tail, white
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.05, 0.01, -0.22, 0.05, 0.01, -0.22, 0.072, 0.0, -0.37, -0.072, 0.0, -0.37], 3));
  tail.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  tail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  tail.setIndex([0, 1, 2, 0, 2, 3]);
  colored(tail, (c) => c.copy(WHITE));
  return mergeGeometries([body, head, beak, eyes, tail]);
}

// --- plumage ----------------------------------------------------------------------------

// atlas: [arm | hand] across, upperside on top, underside below
function plumage() {
  const W = 512, H = 256, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const seg = x < 256 ? 0 : 1, top = y < 128;
    const u = (x % 256) / 255, v = 1 - (y % 128) / 127;    // v: 0 trailing, 1 leading
    let r, g, b, a = 255, shade = 1;
    if (seg === 0) {
      // arm: secondaries (lines across the chord), white trailing edge on top
      const feather = (u * 11) % 1;
      shade = 1 - 0.07 * sm(0.75, 1, feather) * (v < 0.6 ? 1 : 0.3);
      if (top) {
        const edge = sm(0.16, 0.08, v);
        [r, g, b] = [mix(MANTLE.r, WHITE.r, edge), mix(MANTLE.g, WHITE.g, edge), mix(MANTLE.b, WHITE.b, edge)];
        shade *= 1 + 0.06 * sm(0.75, 1, v);              // pale coverts on the leading edge
      } else [r, g, b] = [WHITE.r * 0.95, WHITE.g * 0.95, WHITE.b * 0.96];
      if (v < 0.05 && feather > 0.88) a = 0;             // notched trailing edge
    } else {
      // hand: primaries fanning toward the tip, black ends with white "mirrors"
      const feather = (u * 7 + v * 1.6) % 1;
      shade = 1 - 0.1 * sm(0.7, 1, feather);
      const black = sm(0.42, 0.58, u + v * 0.12);
      const mirror = Math.hypot((u - 0.86) * 1.4, v - 0.42) < 0.09 ? 1 : 0;
      const tipW = u > 0.93 ? 1 : 0;
      if (top) {
        const edge = sm(0.14, 0.07, v) * (1 - black);
        r = mix(mix(MANTLE.r, WHITE.r, edge), 0.05, black); g = mix(mix(MANTLE.g, WHITE.g, edge), 0.05, black); b = mix(mix(MANTLE.b, WHITE.b, edge), 0.055, black);
      } else {
        const k = black * 0.75;
        r = mix(WHITE.r * 0.93, 0.12, k); g = mix(WHITE.g * 0.93, 0.12, k); b = mix(WHITE.b * 0.94, 0.13, k);
      }
      if (mirror || tipW) { r = g = b = 0.9; shade = 1; }
      // separated primaries: gaps open toward the tip and the trailing edge
      if (u > 0.45 && feather > 0.9 - 0.12 * (1 - v) && v < 0.55) a = 0;
    }
    const i = (y * W + x) * 4;
    d[i] = Math.min(255, r * shade * 255); d[i + 1] = Math.min(255, g * shade * 255); d[i + 2] = Math.min(255, b * shade * 255); d[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wingMaterial() {
  const m = new THREE.MeshStandardMaterial({ map: plumage(), roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
  // underside: the same uv, half an atlas lower
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', `
      vec4 sampledDiffuseColor = texture2D(map, gl_FrontFacing ? vMapUv : vMapUv - vec2(0.0, 0.5));
      diffuseColor *= sampledDiffuseColor;`);
  };
  m.customProgramCacheKey = () => 'gull-wing';
  return m;
}

function gull(mats, caster) {
  const bird = new THREE.Group();
  const root = new THREE.Group();                        // bobs against the wingbeat
  bird.add(root);
  root.add(new THREE.Mesh(mats.bodyGeo, mats.body));
  const shoulders = [], hands = [];
  [-1, 1].forEach((side, k) => {
    const sh = new THREE.Group();
    sh.position.set(side * 0.06, 0.035, 0.03);
    sh.add(new THREE.Mesh(WINGS.arm[k], mats.wing));
    const hd = new THREE.Group();
    hd.position.x = side * ARM;
    hd.add(new THREE.Mesh(WINGS.hand[k], mats.wing));
    sh.add(hd);
    root.add(sh);
    shoulders.push(sh); hands.push(hd);
  });
  if (caster) bird.traverse((o) => { if (o.isMesh) o.layers.enable(CASTER_LAYER); });
  return { bird, root, shoulders, hands };
}

// --- behaviour --------------------------------------------------------------------------

const _f = new THREE.Vector3();

export class Birds {
  constructor(count = 9, flocks = 4) {
    this.group = new THREE.Group();
    const mats = {
      bodyGeo: bodyGeometry(),
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
      wing: wingMaterial(),
    };
    const make = (scale, caster, extra) => {
      const g = gull(mats, caster);
      g.bird.scale.setScalar(scale);
      this.group.add(g.bird);
      return {
        ...g, ...extra, scale,
        phase: Math.random() * 100, wingPhase: Math.random() * 6.28,
        flap: 2.4 + Math.random() * 0.6, glide: 1,
        pos: new THREE.Vector3(), yaw: 0, roll: 0,
      };
    };
    // the company under the glider: formation slots in its frame (right, up, forward)
    this.list = [];
    for (let i = 0; i < count; i++) {
      const scale = 2.7 + Math.random() * 0.5;           // big gulls read well from 60 m up
      this.list.push(make(scale, true, {
        slot: new THREE.Vector3((Math.random() - 0.5) * 70, -8 - Math.random() * 26, (Math.random() - 0.5) * 70),
        radius: 0.8 * scale,
      }));
    }
    // thermalling flocks: each circles a column somewhere ahead
    this.flocks = [];
    for (let f = 0; f < flocks; f++) {
      const flock = { center: new THREE.Vector3(), members: [] };
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        flock.members.push(make(2.2 + Math.random() * 0.4, false, {
          R: 18 + Math.random() * 30, h: 12 + Math.random() * 30, w: 0, a0: Math.random() * 6.28, dir: 1,
        }));
      }
      this.flocks.push(flock);
    }
    this.time = 0;
    this.bodies = this.list.map((b) => ({ pos: b.pos, radius: b.radius }));
  }

  place(flight) {
    for (const b of this.list) b.pos.copy(this._target(b, flight, 0));
    this.flocks.forEach((fl, i) => this._spawn(fl, flight, i === 0 ? 120 : 200 + Math.random() * 600));
  }

  _target(b, flight, t) {
    const f = flight.forward(_f), r = new THREE.Vector3(-f.z, 0, f.x);
    const s = b.slot, ph = b.phase;
    const dx = s.x + 9 * Math.sin(t * 0.13 + ph), dz = s.z + 9 * Math.sin(t * 0.11 + ph * 1.7), dyy = s.y + 3 * Math.sin(t * 0.2 + ph);
    return new THREE.Vector3().copy(flight.pos).addScaledVector(r, dx).addScaledVector(f, dz).setY(Math.max(flight.pos.y + dyy, 5));
  }

  // a new thermal ahead of the glider, a little off its track
  _spawn(fl, flight, ahead) {
    const f = flight.forward(_f);
    const side = (Math.random() - 0.5) * 500;
    fl.center.set(flight.pos.x + f.x * ahead - f.z * side, 0, flight.pos.z + f.z * ahead + f.x * side);
    const dir = Math.random() < 0.5 ? -1 : 1;
    for (const m of fl.members) {
      m.dir = dir;
      m.w = (8 + Math.random() * 3) / m.R;                // ~10 m/s around the column
      this._circle(m, fl, this.time);
      m.yaw = Math.atan2(m.vel.x, m.vel.z);
    }
  }

  _circle(m, fl, t) {
    const a = m.a0 + m.dir * m.w * t;
    const y = m.h + 4 * Math.sin(t * 0.21 + m.phase);
    m.pos.set(fl.center.x + Math.cos(a) * m.R, y, fl.center.z + Math.sin(a) * m.R);
    m.vel = (m.vel ?? new THREE.Vector3()).set(-Math.sin(a) * m.dir, 0, Math.cos(a) * m.dir);
  }

  _animate(b, dt, t, wantGlide, turnRate) {
    b.glide += ((wantGlide ? 1 : 0) - b.glide) * (1 - Math.exp(-2.5 * dt));
    const g = b.glide;
    b.wingPhase += dt * b.flap * Math.PI * 2 * (1 - g * 0.85);
    const s = Math.sin(b.wingPhase), up = Math.max(0, Math.cos(b.wingPhase));   // cos > 0: upstroke
    const shZ = THREE.MathUtils.lerp(0.22 + 0.62 * s, 0.1 + 0.03 * Math.sin(t * 0.9 + b.phase), g);
    const hdZ = THREE.MathUtils.lerp(-0.1 + 0.5 * Math.sin(b.wingPhase - 0.9), -0.3, g);
    const shY = THREE.MathUtils.lerp(0.12 * up, 0.04, g);
    const hdY = THREE.MathUtils.lerp(0.55 * up, 0.16, g);   // the hand folds back on the upstroke
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      b.shoulders[k].rotation.set(0, side * shY, side * shZ);
      b.hands[k].rotation.set(0, side * hdY, side * hdZ);
    }
    b.root.position.y = -0.025 * s * (1 - g);
    // bank into the turn (yaw increasing = turning left = left wing, +x, down)
    b.roll += (THREE.MathUtils.clamp(-turnRate * 0.9, -0.7, 0.7) - b.roll) * (1 - Math.exp(-3 * dt));
    b.bird.position.copy(b.pos);
    b.bird.rotation.set(-0.05 * (1 - g) * s, b.yaw, b.roll, 'YXZ');
  }

  update(flight, dt) {
    this.time += dt;
    const t = this.time;
    for (const b of this.list) {
      const target = this._target(b, flight, t);
      const prev = b.pos.clone();
      b.pos.lerp(target, 1 - Math.exp(-1.1 * dt));
      const v = b.pos.clone().sub(prev);
      let turn = 0;
      if (v.lengthSq() > 1e-6 && dt > 0) {
        let d = Math.atan2(v.x, v.z) - b.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const step = d * (1 - Math.exp(-3 * dt));
        b.yaw += step;
        turn = step / dt;
      }
      // flap in bursts, then glide with wings held in the gull's M
      this._animate(b, dt, t, Math.sin(t * 0.35 + b.phase) > 0.0, turn);
    }
    for (const fl of this.flocks) {
      if (Math.hypot(fl.center.x - flight.pos.x, fl.center.z - flight.pos.z) > 1100) this._spawn(fl, flight, 600 + Math.random() * 400);
      for (const m of fl.members) {
        this._circle(m, fl, t);
        const yaw = Math.atan2(m.vel.x, m.vel.z);
        m.yaw = yaw;
        // thermalling: mostly soaring, a few beats now and then
        this._animate(m, dt, t, Math.sin(t * 0.23 + m.phase) > -0.6, -m.dir * m.w);   // yaw = -a
      }
    }
  }
}
