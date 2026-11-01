import * as THREE from 'three';

// Vapour off the winglet tips: two camera-facing ribbons that only show when the wing is
// working (hard banks, pull-ups, full speed) and fade along their length.
const N = 70;
const TIPS = [new THREE.Vector3(-12.8, 2.0, -8.5), new THREE.Vector3(12.8, 2.0, -8.5)];

const VERT = /* glsl */`
attribute float aAlpha;
varying float vAlpha;
varying float vSide;
attribute float aSide;
void main() {
  vAlpha = aAlpha;
  vSide = aSide;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
varying float vAlpha;
varying float vSide;
uniform vec3 uColor;
void main() {
  float edge = 1.0 - abs(vSide);          // soft across the ribbon
  gl_FragColor = vec4(uColor, vAlpha * edge * edge);
}`;

export class Trails {
  constructor() {
    this.group = new THREE.Group();
    this.ribbons = TIPS.map(() => {
      const pts = Array.from({ length: N }, () => new THREE.Vector3());
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(N * 2), 1));
      const side = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; }
      g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
      const idx = [];
      for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, uniforms: { uColor: { value: new THREE.Color(1.6, 1.6, 1.65) } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }));
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return { pts, power: new Float32Array(N), g, primed: false };
    });
    this.intensity = 0;
    this._acc = 0;
  }

  update(dt, glider, flight, camera) {
    // how hard the wing is working
    const want = THREE.MathUtils.clamp((Math.abs(flight.bank) - 0.38) * 2.2, 0, 1) * 0.7
      + THREE.MathUtils.clamp(flight.throttle - 0.55, 0, 1) * 1.2
      + THREE.MathUtils.clamp(Math.abs(flight.pitch) - 0.12, 0, 1) * 2;
    this.intensity += (Math.min(1, want) - this.intensity) * (1 - Math.exp(-3 * dt));
    glider.body.updateMatrixWorld();
    this._acc += dt;
    const step = this._acc >= 1 / 30;            // new sample at 30 Hz, the head follows every frame
    if (step) this._acc = 0;
    const cam = camera.position, tmp = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
    this.ribbons.forEach((r, k) => {
      const tip = glider.body.localToWorld(tmp.copy(TIPS[k]));
      if (!r.primed) { r.pts.forEach((p) => p.copy(tip)); r.primed = true; }
      if (step) {
        for (let i = N - 1; i > 0; i--) { r.pts[i].copy(r.pts[i - 1]); r.power[i] = r.power[i - 1]; }
      }
      r.pts[0].copy(tip);
      r.power[0] = this.intensity;
      const pos = r.g.attributes.position.array, al = r.g.attributes.aAlpha.array;
      for (let i = 0; i < N; i++) {
        const p = r.pts[i], q = r.pts[Math.min(N - 1, i + 1)], o = r.pts[Math.max(0, i - 1)];
        dir.subVectors(o, q);
        side.subVectors(cam, p).cross(dir).normalize();
        const t = i / (N - 1), w = 0.12 + 0.9 * t;   // widens as it diffuses
        for (let s = 0; s < 2; s++) {
          const j = (i * 2 + s) * 3, sg = s ? 1 : -1;
          pos[j] = p.x + side.x * w * sg; pos[j + 1] = p.y + side.y * w * sg; pos[j + 2] = p.z + side.z * w * sg;
          al[i * 2 + s] = r.power[i] * 0.45 * Math.pow(1 - t, 1.6) * Math.min(1, i / 3);
        }
      }
      r.g.attributes.position.needsUpdate = true;
      r.g.attributes.aAlpha.needsUpdate = true;
    });
  }
}
