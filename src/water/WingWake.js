import * as THREE from 'three';
import { WATER_GLSL } from './OceanSurface.js';
import { worldHeight } from '../world/worldHeight.js';

// Each wing owns a circular buffer of short strips. Old strips fade in place; they
// never bridge a gap in contact, and the GPU follows the same displaced water as
// the ocean without a synchronous height readback.
const SEGMENTS = 64;
const LIFE = 1.5;
const WIDTH = 0.34;
const SAMPLE_DISTANCE = 0.65;
const IMPACT_LIFE = 1.5;
const IMPACT_INTERVAL = 0.2;
const VERT = /* glsl */`
${WATER_GLSL}
in float aAge;
in float aStrength;
in vec2 aSpread;
out float vAlpha;
out vec2 vUv;
out vec2 vXZ;
void main() {
  if (aStrength <= 0.0 || aAge >= ${LIFE.toFixed(2)}) { vAlpha = 0.0; vUv = uv; vXZ = position.xz; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 xz = position.xz + aSpread * aAge * 1.35;
  float water = waterAt(xz, vec3(0.0)).y;
  vAlpha = aStrength * pow(max(0.0, 1.0 - aAge / ${LIFE.toFixed(2)}), 1.2);
  vUv = uv;
  vXZ = xz;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, water + 0.14, xz.y, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uFoamTex;
in float vAlpha;
in vec2 vUv;
in vec2 vXZ;
out vec4 fragColor;
void main() {
  // Two textured edges leave dark water between them as the wake opens.
  float edge = abs(vUv.x * 2.0 - 1.0);
  float bands = smoothstep(0.20, 0.55, edge) * (1.0 - smoothstep(0.86, 1.0, edge));
  float texture_ = texture(uFoamTex, vXZ * 0.32).r;
  fragColor = vec4(0.94, 0.98, 1.0, vAlpha * bands * (0.55 + 0.40 * texture_));
}`;
const SPRAY_VERT = /* glsl */`
${WATER_GLSL}
in float aAge;
in float aStrength;
in vec2 aSpread;
out float vAlpha;
void main() {
  if (aStrength <= 0.0 || aAge >= 0.95) { vAlpha = 0.0; gl_PointSize = 1.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float t = aAge;
  // Each shared strip vertex is a small droplet with a distinct, outward arc.
  float seed = hash12(vec2(float(gl_VertexID), 1.7));
  float turn = hash12(vec2(float(gl_VertexID), 8.3));
  float arc = (3.2 + 1.7 * seed) * t - 4.9 * t * t;
  if (arc < -0.03) { vAlpha = 0.0; gl_PointSize = 1.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 tangent = vec2(-aSpread.y, aSpread.x);
  vec2 velocity = aSpread * (1.5 + 1.1 * seed) + tangent * ((turn - 0.5) * 1.1);
  vec2 xz = position.xz + velocity * t;
  float water = waterAt(xz, vec3(0.0)).y;
  vAlpha = aStrength * smoothstep(0.0, 0.06, t) * smoothstep(-0.03, 0.09, arc)
         * pow(max(0.0, 1.0 - t / 0.95), 1.15);
  vec4 view = viewMatrix * vec4(xz.x, water + 0.08 + max(0.0, arc), xz.y, 1.0);
  gl_PointSize = clamp(180.0 / max(1.0, -view.z), 1.8, 8.0);
  gl_Position = projectionMatrix * view;
}`;
const SPRAY_FRAG = /* glsl */`
precision highp float;
in float vAlpha;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  fragColor = vec4(0.88, 0.96, 1.0, vAlpha * (1.0 - smoothstep(0.25, 1.0, r)) * 0.60);
}`;

export class WingWake {
  constructor(surface) {
    this.group = new THREE.Group();
    this.impacts = surface.uniforms.uImpact.value;
    this.impactSizes = surface.uniforms.uImpactSize.value;
    // Vector4 defaults w to 1; mark all slots free before the first frame.
    for (const impact of this.impacts) impact.set(0, 0, 0, 0);
    this.impactCooldown = 0;
    this.impactCursor = 0;
    this.positions = new Float32Array(SEGMENTS * 2 * 4 * 3);
    this.ages = new Float32Array(SEGMENTS * 2 * 4).fill(LIFE);
    this.strengths = new Float32Array(SEGMENTS * 2 * 4);
    this.spread = new Float32Array(SEGMENTS * 2 * 4 * 2);
    this.geo = new THREE.BufferGeometry();
    for (const [name, array, size] of [['position', this.positions, 3], ['aAge', this.ages, 1], ['aStrength', this.strengths, 1], ['aSpread', this.spread, 2]]) {
      this.geo.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    }
    const uv = new Float32Array(SEGMENTS * 2 * 8), indices = [];
    for (let i = 0; i < SEGMENTS * 2; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      const v = i * 4; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(indices);
    const uniforms = { ...surface.uniforms };
    this.mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, glslVersion: THREE.GLSL3, transparent: true, depthTest: true, depthWrite: false, side: THREE.DoubleSide }));
    // Non-indexed points share the strip attributes without drawing indexed duplicates.
    this.sprayGeo = new THREE.BufferGeometry();
    for (const name of ['position', 'aAge', 'aStrength', 'aSpread']) this.sprayGeo.setAttribute(name, this.geo.getAttribute(name));
    this.spray = new THREE.Points(this.sprayGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, glslVersion: THREE.GLSL3, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = this.spray.frustumCulled = false;
    this.group.add(this.mesh, this.spray);
    this.tips = [new THREE.Vector3(), new THREE.Vector3()];
    this.previous = [new THREE.Vector3(), new THREE.Vector3()];
    this.active = [false, false];
    this.cursor = [0, 0];
    this.contactStrength = 0;
    this.contactPan = 0;
    this.contactPoint = new THREE.Vector3();
    this.sideStrength = [0, 0];
  }

  update(dt, wingTips, flight) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    for (const impact of this.impacts) {
      if (impact.w > 0) {
        impact.z += dt;
        if (impact.z >= IMPACT_LIFE) impact.w = 0;
      }
    }
    for (let i = 0; i < this.ages.length; i++) this.ages[i] = Math.min(LIFE, this.ages[i] + dt);
    let strongest = 0, pan = 0;
    for (let side = 0; side < 2; side++) {
      const node = wingTips[side], p = this.tips[side], prev = this.previous[side];
      node.updateWorldMatrix(true, false);
      node.getWorldPosition(p);
      const speed = THREE.MathUtils.clamp((flight.speed - 8) / 28, 0, 1);
      const bank = THREE.MathUtils.clamp((Math.abs(flight.bank) - 0.25) / 0.25, 0, 1);
      // The GPU-displaced waves are not available to the CPU. Allow a small
      // envelope around mean sea level so moderate banks can catch the swell.
      const near = 1 - THREE.MathUtils.smoothstep(Math.abs(p.y), 0.4, 2.2);
      const water = near > 0 && bank > 0 && speed > 0 && worldHeight(p.x, p.z) < -0.5 && flight.obstacleTop(p.x, p.z) < 0;
      const target = speed * bank * near * (water ? 1 : 0);
      const sideResponse = 1 - Math.exp(-dt * (target > this.sideStrength[side] ? 12 : 6));
      this.sideStrength[side] += (target - this.sideStrength[side]) * sideResponse;
      // Never emit a trailing ghost after leaving the water envelope.
      const strength = target > 0 ? this.sideStrength[side] : 0;
      if (strength > strongest) {
        strongest = strength;
        pan = side === 0 ? 1 : -1;
        this.contactPoint.copy(p);
      }
      if (strength > 0.1 && this.impactCooldown <= 0) {
        const slot = this.impactCursor;
        this.impactCursor = (slot + 1) % this.impacts.length;
        this.impacts[slot].set(p.x, p.z, 0, 0.02 + 0.01 * strength);
        this.impactSizes[slot] = 0.3;
        this.impactCooldown = IMPACT_INTERVAL;
      }
      const dx = p.x - prev.x, dz = p.z - prev.z, len = Math.hypot(dx, dz);
      if (strength > 0.01 && this.active[side] && len >= SAMPLE_DISTANCE && len < 8) {
        const slot = side * SEGMENTS + this.cursor[side];
        this.cursor[side] = (this.cursor[side] + 1) % SEGMENTS;
        const nx = -dz / len * WIDTH, nz = dx / len * WIDTH;
        for (let j = 0; j < 4; j++) {
          const v = slot * 4 + j;
          const end = j < 2 ? prev : p, sign = j % 2 === 0 ? 1 : -1;
          this.positions[v * 3] = end.x + sign * nx; this.positions[v * 3 + 2] = end.z + sign * nz;
          this.ages[v] = 0; this.strengths[v] = strength;
          this.spread[v * 2] = sign * nx / WIDTH; this.spread[v * 2 + 1] = sign * nz / WIDTH;
        }
      }
      // Preserve a metre-scale trail on fast displays rather than spending the
      // entire fixed pool on tiny segments in a fraction of a second.
      if (strength <= 0.01 || !this.active[side] || len >= SAMPLE_DISTANCE) prev.copy(p);
      this.active[side] = strength > 0.01;
    }
    const response = 1 - Math.exp(-dt * (strongest > this.contactStrength ? 12 : 5));
    this.contactStrength += (strongest - this.contactStrength) * response;
    if (strongest > 0) this.contactPan += (pan - this.contactPan) * (1 - Math.exp(-dt * 10));
    for (const name of ['position', 'aAge', 'aStrength', 'aSpread']) this.geo.attributes[name].needsUpdate = true;
  }
}
