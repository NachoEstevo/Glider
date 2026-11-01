import * as THREE from 'three';
import { worldHeight, WORLD_RADIUS, CITIES, LANDMARKS } from '../world/worldHeight.js';
import { ObstacleAvoidance } from './obstacleAvoidance.js';

// Calm arcade flight: coordinated turns (yaw rate from bank), eased climb, a floor kept
// above terrain and roofs, and an autopilot that wanders between cities and islands
// whenever the pilot lets go.
const G = 9.81;
const CRUISE = 34, BOOST = 72, MIN_ALT = 14, MAX_ALT = 420;
const MAX_BANK = THREE.MathUtils.degToRad(38);

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class Flight {
  constructor({ start = new THREE.Vector3(0, 70, 0), heading = 0.6, obstacleTop = () => -Infinity, terrain = worldHeight } = {}) {
    this.pos = start.clone();
    this.heading = heading;        // radians, 0 = +z
    this.bank = 0;
    this.pitch = 0;
    this.speed = CRUISE;
    this.vSpeed = 0;
    this.throttle = 0;             // 0..1, drives engine glow and wind
    this.targetAlt = start.y;
    this.input = { steer: 0, climb: 0, boost: false };
    this.idle = 0;                 // seconds without pilot input
    this.autopilot = true;
    this.obstacleTop = obstacleTop;
    this.terrain = terrain;
    this.clearanceAge = Infinity;
    this.avoidance = new ObstacleAvoidance(terrain, obstacleTop);
    this.waypoint = new THREE.Vector2(start.x, start.z);
    this.speedScale = 1;           // intro cutscene throttles this
    this._pickWaypoint();
    this.time = 0;
    this.distance = 0;
  }

  _pickWaypoint() {
    // drowned cities, landmarks and random spots on the shelf
    const r = Math.random();
    if (r < 0.25) {
      const l = LANDMARKS[Math.floor(Math.random() * LANDMARKS.length)];
      this.waypoint.set(l.x + (Math.random() - 0.5) * 120, l.z + (Math.random() - 0.5) * 120);
    } else if (r < 0.65) {
      const c = CITIES[Math.floor(Math.random() * CITIES.length)];
      this.waypoint.set(c.x + (Math.random() - 0.5) * c.r, c.z + (Math.random() - 0.5) * c.r);
    } else {
      const a = Math.random() * Math.PI * 2, d = Math.random() * (WORLD_RADIUS - 600);
      this.waypoint.set(Math.cos(a) * d, Math.sin(a) * d);
    }
    this.cruiseAlt = 45 + Math.random() * 70;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Bound integration steps so a slow frame cannot tunnel through a roof.
    while (dt > 0) {
      const step = Math.min(dt, 0.1);
      this._updateStep(step);
      dt -= step;
    }
  }

  _updateStep(dt) {
    this.time += dt;
    const inp = this.input;
    const active = Math.abs(inp.steer) > 0.02 || Math.abs(inp.climb) > 0.02 || inp.boost;
    this.idle = active ? 0 : this.idle + dt;
    const auto = this.autopilot && this.idle > 6;

    let steer = inp.steer, climb = inp.climb;
    if (auto) {
      const to = new THREE.Vector2(this.waypoint.x - this.pos.x, this.waypoint.y - this.pos.z);
      if (to.length() < 220) this._pickWaypoint();
      const want = Math.atan2(to.x, to.y);
      let err = want - this.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      steer = THREE.MathUtils.clamp(-err * 1.2, -0.7, 0.7);
      climb = THREE.MathUtils.clamp((this.cruiseAlt - this.pos.y) / 40, -0.5, 0.5);
    }
    // soft world edge: lean back towards the middle
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > WORLD_RADIUS - 300) {
      const want = Math.atan2(-this.pos.x, -this.pos.z);
      let err = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      const k = THREE.MathUtils.smoothstep(r, WORLD_RADIUS - 300, WORLD_RADIUS + 200);
      steer = THREE.MathUtils.lerp(steer, THREE.MathUtils.clamp(-err * 1.5, -1, 1), k);
    }

    this.clearanceAge += dt;
    if (this.clearanceAge >= 0.1) {
      this.clearance = this.avoidance.sample(this.pos, this.heading, this.speed, this.clearanceAge);
      this.clearanceAge = 0;
    }
    const clearance = this.clearance;
    this.avoidanceAssist = clearance.steer;
    // Pilot input can resist the assist; it retains limited authority.
    steer = THREE.MathUtils.clamp(steer + clearance.steer, -1, 1);

    // ease the stick itself: keys are all-or-nothing, the craft should not be
    this.stick ??= { steer: 0, climb: 0 };
    steer = this.stick.steer = damp(this.stick.steer, steer, 2.2, dt);
    climb = this.stick.climb = damp(this.stick.climb, climb, 1.8, dt);

    // a slow breathing drift so the craft never sits perfectly still
    const sway = 0.04 * Math.sin(this.time * 0.37) + 0.025 * Math.sin(this.time * 0.91 + 1.3);
    // steer +1 = right; with the nose on +z, a positive roll lifts the left (+x) wing
    this.bank = damp(this.bank, steer * MAX_BANK + sway, 1.25, dt);

    const targetSpeed = (inp.boost ? BOOST : CRUISE) * this.speedScale;
    this.speed = damp(this.speed, targetSpeed, inp.boost ? 0.7 : 0.45, dt);
    this.throttle = damp(this.throttle, THREE.MathUtils.clamp((this.speed - CRUISE * 0.5) / (BOOST - CRUISE * 0.5), 0, 1), 2, dt);

    // coordinated turn; turning right lowers the heading (0 = +z, +pi/2 = +x)
    const yawRate = (G * Math.tan(this.bank)) / Math.max(this.speed, 8);
    this.heading -= yawRate * dt;

    // altitude: climb input sets vertical speed, with floor/ceiling
    let nearTop = 0, nearHazard = false;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const d of [0, Math.max(22, this.speed * 0.7)]) {
      for (const lateral of [-14, -7, 0, 7, 14]) {
        const x = this.pos.x + fx * d + fz * lateral;
        const z = this.pos.z + fz * d - fx * lateral;
        const terrain = this.terrain(x, z), roof = this.obstacleTop(x, z);
        nearTop = Math.max(nearTop, terrain, roof);
        if (terrain > -1 || roof > -1) nearHazard = true;
      }
    }
    // Keep low flight for clear water; rise early for terrain and nearby roofs.
    const floor = clearance.water ? 6.9 : Math.max(nearTop, clearance.terrainAhead) + MIN_ALT;
    let vs = climb * 14;
    const recoveryHeight = floor + (clearance.water ? 0 : 6);
    if (this.pos.y < recoveryHeight) vs = Math.max(vs, (recoveryHeight - this.pos.y) * 1.2);
    if (this.pos.y > MAX_ALT) vs = Math.min(vs, (MAX_ALT - this.pos.y) * 0.8);
    this.vSpeed = damp(this.vSpeed, vs, 1.1, dt);

    const f = this.forward();
    this.pos.addScaledVector(f, this.speed * dt);
    const destinationTerrain = this.terrain(this.pos.x, this.pos.z);
    const destinationRoof = this.obstacleTop(this.pos.x, this.pos.z);
    const destinationGround = Math.max(destinationTerrain, 0, destinationRoof);
    const destinationHazard = destinationTerrain > -1 || destinationRoof > -1;
    const floorLimit = nearHazard || destinationHazard ? Math.max(destinationGround, nearTop) + MIN_ALT : 6.9;
    const nextY = this.pos.y + this.vSpeed * dt;
    this.pos.y = Math.max(nextY, floorLimit);
    if (nextY <= floorLimit && this.vSpeed < 0) this.vSpeed = 0;
    this.pitch = damp(this.pitch, Math.atan2(this.vSpeed, this.speed) * 0.9, 1.9, dt);
    this.distance += this.speed * dt;
  }

  applyTo(glider) {
    glider.root.position.copy(this.pos);
    glider.root.rotation.set(0, this.heading, 0);
    glider.body.rotation.set(-this.pitch, 0, this.bank, 'YXZ');
  }
}
