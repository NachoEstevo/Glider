import * as THREE from 'three';
import { WATER_GLSL } from './OceanSurface.js';
import { worldHeight } from '../world/worldHeight.js';

// Each wing owns a circular buffer of short strips. Old strips fade in place; they
// never bridge a gap in contact, and the GPU follows the same displaced water as
// the ocean without a synchronous height readback.
const SEGMENTS = 64;
const LIFE = 1.15;
const WIDTH = 0.13;
const IMPACT_LIFE = 1.5;
const IMPACT_INTERVAL = 0.2;
const VERT = /* glsl */`
${WATER_GLSL}
in float aAge;
in float aStrength;
in float aTipHeight;
out float vAlpha;
out vec2 vUv;
void main() {
  if (aStrength <= 0.0 || aAge >= 1.15) { vAlpha = 0.0; vUv = uv; gl_Position = vec4(2.0); return; }
  vec2 xz = position.xz;
  float water = waterAt(xz, vec3(0.0)).y;
  float contact = 1.0 - smoothstep(0.25, 1.1, abs(aTipHeight - water));
  vAlpha = aStrength * contact * pow(max(0.0, 1.0 - aAge / ${LIFE.toFixed(2)}), 1.5);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, water + 0.08, xz.y, 1.0);
}`;
const FRAG = /* glsl */`
precision highp float;
in float vAlpha;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float edge = 1.0 - smoothstep(0.35, 1.0, abs(vUv.x * 2.0 - 1.0));
  fragColor = vec4(0.88, 0.96, 1.0, vAlpha * edge * 0.5);
}`;
const SPRAY_VERT = /* glsl */`
${WATER_GLSL}
in float aAge;
in float aStrength;
in float aTipHeight;
out float vAlpha;
void main() {
  if (aStrength <= 0.0 || aAge >= 0.45) { vAlpha = 0.0; gl_PointSize = 1.0; gl_Position = vec4(2.0); return; }
  float water = waterAt(position.xz, vec3(0.0)).y;
  float contact = 1.0 - smoothstep(0.25, 1.1, abs(aTipHeight - water));
  float t = aAge;
  vAlpha = aStrength * contact * max(0.0, 1.0 - t / 0.45);
  vec4 view = viewMatrix * vec4(position.x, water + 0.12 + t * 0.65, position.z, 1.0);
  gl_PointSize = clamp(20.0 / max(1.0, -view.z), 1.0, 3.0);
  gl_Position = projectionMatrix * view;
}`;
const SPRAY_FRAG = /* glsl */`
precision highp float;
in float vAlpha;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  fragColor = vec4(0.7, 0.85, 0.9, vAlpha * (1.0 - smoothstep(0.15, 1.0, r)) * 0.25);
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
    this.heights = new Float32Array(SEGMENTS * 2 * 4);
    this.geo = new THREE.BufferGeometry();
    for (const [name, array, size] of [['position', this.positions, 3], ['aAge', this.ages, 1], ['aStrength', this.strengths, 1], ['aTipHeight', this.heights, 1]]) {
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
    this.spray = new THREE.Points(this.geo, new THREE.ShaderMaterial({ uniforms, vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG, glslVersion: THREE.GLSL3, transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.mesh.frustumCulled = this.spray.frustumCulled = false;
    this.group.add(this.mesh, this.spray);
    this.tips = [new THREE.Vector3(), new THREE.Vector3()];
    this.previous = [new THREE.Vector3(), new THREE.Vector3()];
    this.active = [false, false];
    this.cursor = [0, 0];
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
    for (let side = 0; side < 2; side++) {
      const node = wingTips[side], p = this.tips[side], prev = this.previous[side];
      node.updateWorldMatrix(true, false);
      node.getWorldPosition(p);
      const speed = THREE.MathUtils.clamp((flight.speed - 8) / 28, 0, 1);
      const bank = THREE.MathUtils.clamp((Math.abs(flight.bank) - 0.25) / 0.25, 0, 1);
      const near = 1 - THREE.MathUtils.smoothstep(Math.abs(p.y), 0.4, 1.3);
      const water = near > 0 && bank > 0 && speed > 0 && worldHeight(p.x, p.z) < -0.5 && flight.obstacleTop(p.x, p.z) < 0;
      const strength = speed * bank * near * (water ? 1 : 0);
      if (strength > 0.1 && this.impactCooldown <= 0) {
        const slot = this.impactCursor;
        this.impactCursor = (slot + 1) % this.impacts.length;
        this.impacts[slot].set(p.x, p.z, 0, 0.02 + 0.01 * strength);
        this.impactSizes[slot] = 0.3;
        this.impactCooldown = IMPACT_INTERVAL;
      }
      const dx = p.x - prev.x, dz = p.z - prev.z, len = Math.hypot(dx, dz);
      if (strength > 0.01 && this.active[side] && len > 0.01 && len < 8) {
        const slot = side * SEGMENTS + this.cursor[side];
        this.cursor[side] = (this.cursor[side] + 1) % SEGMENTS;
        const nx = -dz / len * WIDTH, nz = dx / len * WIDTH;
        for (let j = 0; j < 4; j++) {
          const v = slot * 4 + j;
          const end = j < 2 ? prev : p, sign = j % 2 === 0 ? 1 : -1;
          this.positions[v * 3] = end.x + sign * nx; this.positions[v * 3 + 2] = end.z + sign * nz;
          this.ages[v] = 0; this.strengths[v] = strength; this.heights[v] = j < 2 ? prev.y : p.y;
        }
      }
      this.active[side] = strength > 0.01;
      prev.copy(p);
    }
    for (const name of ['position', 'aAge', 'aStrength', 'aTipHeight']) this.geo.attributes[name].needsUpdate = true;
  }
}
