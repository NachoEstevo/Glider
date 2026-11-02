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

// Conservative cross covering the wing and the fuselage from nose to tail.
function obstructed(topAt, x, z, heading, altitude) {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  for (let lateral = -14; lateral <= 14; lateral += 0.5) {
    if (topAt(x + fz * lateral, z - fx * lateral) + MIN_ALT > altitude) return true;
  }
  for (let longitudinal = -9; longitudinal <= 9; longitudinal += 1) {
    for (const lateral of [-3, 0, 3]) {
      if (topAt(x + fx * longitudinal + fz * lateral, z + fz * longitudinal - fx * lateral) + MIN_ALT > altitude) return true;
    }
  }
  return false;
}

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

  update(dt, { gliding = false } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Bound integration steps so a slow frame cannot tunnel through a roof.
    while (dt > 0) {
      const step = Math.min(dt, 0.1);
      this._updateStep(step, gliding);
      dt -= step;
    }
  }

  _updateStep(dt, gliding) {
    this.time += dt;
    const inp = this.input;
    const active = !gliding && (Math.abs(inp.steer) > 0.02 || Math.abs(inp.climb) > 0.02 || inp.boost);
    this.idle = active ? 0 : this.idle + dt;
    const auto = !gliding && this.autopilot && this.idle > 6;

    let steer = gliding ? 0 : inp.steer, climb = gliding ? -0.05 : inp.climb;
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
    // A threatened corridor gets priority over input that points into it.
    // The regular stick and bank damping retain the smooth roll-in.
    if (clearance.steer) steer = clearance.steer;

    // ease the stick itself: keys are all-or-nothing, the craft should not be
    this.stick ??= { steer: 0, climb: 0 };
    steer = this.stick.steer = damp(this.stick.steer, steer, 2.2, dt);
    climb = this.stick.climb = damp(this.stick.climb, climb, 1.8, dt);

    // a slow breathing drift so the craft never sits perfectly still
    const sway = 0.04 * Math.sin(this.time * 0.37) + 0.025 * Math.sin(this.time * 0.91 + 1.3);
    // steer +1 = right; with the nose on +z, a positive roll lifts the left (+x) wing
    this.bank = damp(this.bank, steer * MAX_BANK + sway, 1.25, dt);

    let targetSpeed = gliding ? 20 : (inp.boost ? BOOST : CRUISE) * this.speedScale;
    if (Number.isFinite(clearance.distance)) {
      // Start shedding speed before the turn radius becomes too large.
      targetSpeed = Math.min(targetSpeed, Math.max(8, Math.sqrt(Math.max(0, clearance.distance - 25) * 16)));
    }
    this.speed = damp(this.speed, targetSpeed, targetSpeed < this.speed && Number.isFinite(clearance.distance) ? 1.2 : (gliding ? 0.12 : (inp.boost ? 0.7 : 0.45)), dt);
    this.throttle = gliding ? 0 : damp(this.throttle, THREE.MathUtils.clamp((this.speed - CRUISE * 0.5) / (BOOST - CRUISE * 0.5), 0, 1), 2, dt);

    // coordinated turn; turning right lowers the heading (0 = +z, +pi/2 = +x)
    const yawRate = (G * Math.tan(this.bank)) / Math.max(this.speed, 8);
    const oldHeading = this.heading;
    const nextHeading = oldHeading - yawRate * dt;
    const turnBlocked = obstructed(this.obstacleTop, this.pos.x, this.pos.z, nextHeading, this.pos.y);
    if (!turnBlocked) this.heading = nextHeading;

    // altitude: climb input sets vertical speed, with floor/ceiling
    let nearTerrain = 0, nearTerrainHazard = false;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const d of [0, Math.max(22, this.speed * 0.7)]) {
      for (const lateral of [-14, -7, 0, 7, 14]) {
        const x = this.pos.x + fx * d + fz * lateral;
        const z = this.pos.z + fz * d - fx * lateral;
        const terrain = this.terrain(x, z);
        nearTerrain = Math.max(nearTerrain, terrain);
        if (terrain > -1) nearTerrainHazard = true;
      }
    }
    // Building avoidance is horizontal; only terrain participates in the floor.
    const floor = clearance.terrainAhead > -1 && (nearTerrainHazard || clearance.terrainAhead > 0)
      ? Math.max(nearTerrain, clearance.terrainAhead) + MIN_ALT : 6.9;
    let vs = climb * 14;
    const recoveryHeight = floor + (floor > 6.9 ? 6 : 0);
    if (this.pos.y < recoveryHeight) vs = Math.max(vs, (recoveryHeight - this.pos.y) * 1.2);
    if (this.pos.y > MAX_ALT) vs = Math.min(vs, (MAX_ALT - this.pos.y) * 0.8);
    // Ease the requested descent well before reaching the water. The low gain
    // accounts for vertical-speed response lag and prevents a floor impact.
    if (floor === 6.9 && vs < 0) vs = Math.max(vs, -0.25 * Math.max(0, this.pos.y - floor));
    const desiredVSpeed = damp(this.vSpeed, vs, 1.1, dt);
    this.vSpeed += THREE.MathUtils.clamp(desiredVSpeed - this.vSpeed, -8 * dt, 8 * dt);

    const f = this.forward();
    // Sweep the full wingspan along this step. This is an emergency backstop
    // for late/narrow detections; anticipation normally keeps it inactive.
    const travel = this.speed * dt;
    const segments = Math.max(1, Math.ceil(travel / 2));
    let safeTravel = 0;
    for (let i = 1; i <= segments; i++) {
      const d = travel * i / segments;
      if (obstructed(this.obstacleTop, this.pos.x + f.x * d, this.pos.z + f.z * d, this.heading, this.pos.y)) break;
      safeTravel = d;
    }
    this.pos.addScaledVector(f, safeTravel);
    // If detection came too late to turn, ease sideways away from the wall so
    // the guard does not leave the aircraft permanently pinned against it.
    const escapeNeeded = this.avoidance.side && (safeTravel < travel || clearance.distance < Math.max(45, this.speed * 2.5));
    this.escapeSpeed = damp(this.escapeSpeed ?? 0, escapeNeeded ? 8 : 0, 1.4, dt);
    if (this.escapeSpeed > 0.01 && this.avoidance.side) {
      const slide = -this.avoidance.side * this.escapeSpeed * dt;
      const x = this.pos.x + f.z * slide, z = this.pos.z - f.x * slide;
      if (!obstructed(this.obstacleTop, x, z, this.heading, this.pos.y)) {
        this.pos.x = x;
        this.pos.z = z;
      }
    }
    const destinationTerrain = this.terrain(this.pos.x, this.pos.z);
    const floorLimit = nearTerrainHazard || destinationTerrain > -1 ? Math.max(destinationTerrain, nearTerrain, 0) + MIN_ALT : 6.9;
    let nextY = this.pos.y + this.vSpeed * dt;
    // A roof below may arrest descent, but must never push the aircraft upward.
    if (nextY < this.pos.y && obstructed(this.obstacleTop, this.pos.x, this.pos.z, this.heading, nextY)) {
      nextY = this.pos.y;
      this.vSpeed = 0;
    }
    this.pos.y = Math.max(nextY, floorLimit);
    if (nextY <= floorLimit && this.vSpeed < 0) this.vSpeed = 0;
    this.pitch = damp(this.pitch, Math.atan2(this.vSpeed, this.speed) * 0.9, 1.9, dt);
    this.distance += safeTravel;
  }

  applyTo(glider) {
    glider.root.position.copy(this.pos);
    glider.root.rotation.set(0, this.heading, 0);
    glider.body.rotation.set(-this.pitch, 0, this.bank, 'YXZ');
  }
}
