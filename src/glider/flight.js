import * as THREE from 'three';
import { worldHeight, WORLD_RADIUS, CITIES, LANDMARKS } from '../world/worldHeight.js';

// Calm arcade flight: coordinated turns (yaw rate from bank), eased climb, a floor kept
// above terrain and roofs, and an autopilot that wanders between cities and islands
// whenever the pilot lets go.
const G = 9.81;
const CRUISE = 34, BOOST = 72, MIN_ALT = 14, MAX_ALT = 420;
const MAX_BANK = THREE.MathUtils.degToRad(38);

const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class Flight {
  constructor({ start = new THREE.Vector3(0, 70, 0), heading = 0.6, obstacleTop = () => -Infinity } = {}) {
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
    const ground = Math.max(worldHeight(this.pos.x, this.pos.z), 0, this.obstacleTop(this.pos.x, this.pos.z));
    const ahead = this.forward().multiplyScalar(this.speed * 2.5).add(this.pos);
    const groundAhead = Math.max(worldHeight(ahead.x, ahead.z), 0, this.obstacleTop(ahead.x, ahead.z));
    const floor = Math.max(ground, groundAhead) + MIN_ALT;
    let vs = climb * 14;
    if (this.pos.y < floor + 6) vs = Math.max(vs, (floor + 6 - this.pos.y) * 1.2);
    if (this.pos.y > MAX_ALT) vs = Math.min(vs, (MAX_ALT - this.pos.y) * 0.8);
    this.vSpeed = damp(this.vSpeed, vs, 1.1, dt);
    this.pitch = damp(this.pitch, Math.atan2(this.vSpeed, this.speed) * 0.9, 1.9, dt);

    const f = this.forward();
    this.pos.addScaledVector(f, this.speed * dt);
    this.pos.y = Math.max(this.pos.y + this.vSpeed * dt, ground + 4);
    this.distance += this.speed * dt;
  }

  applyTo(glider) {
    glider.root.position.copy(this.pos);
    glider.root.rotation.set(0, this.heading, 0);
    glider.body.rotation.set(-this.pitch, 0, this.bank, 'YXZ');
  }
}
