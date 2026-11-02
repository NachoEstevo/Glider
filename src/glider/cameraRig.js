import * as THREE from 'three';

// Camera modes, eased into each other:
//  overhead — looking straight down on the glider, which crosses the frame on a diagonal
//             (the framing of the video)
//  chase    — behind and above, towards the horizon
//  orbit    — a slow cinematic circle around the craft
export const MODES = ['overhead', 'chase', 'orbit'];

const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3(), _u = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'overhead';
    this.zoom = 1;                 // wheel, 0.5..2.2
    this.orbitAngle = 0;
    this.pos = new THREE.Vector3(0, 200, 0);
    this.look = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 0, 1);
    this.yaw = 0;
    this.lastMode = this.mode;
    this.overheadTransition = null;
    this.intro = 0;                // 1 = high establishing shot, eases to 0
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  snap(flight) {
    this.overheadTransition = null;
    this.lastMode = this.mode;
    this.update(flight, 10);
  }

  update(flight, dt) {
    if (this.mode !== this.lastMode) {
      this.overheadTransition = this.mode === 'overhead' ? {
        elapsed: 0,
        pos: this.pos.clone(), look: this.look.clone(), up: this.up.clone(),
        origin: flight.pos.clone(), yaw: this.yaw,
      } : null;
      this.lastMode = this.mode;
    }
    const transition = this.overheadTransition;
    if (transition) transition.elapsed = Math.min(2.8, transition.elapsed + Math.max(0, dt));
    const t = transition ? transition.elapsed / 2.8 : 1;
    const blend = t * t * (3 - 2 * t);
    // portrait screens see a narrow slice horizontally: pull back to keep the framing
    const g = flight.pos, z = this.zoom * (this.camera.aspect < 1 ? 1.75 : 1);
    // heading follows lazily so turns read as the glider swinging across the frame
    let dy = flight.heading - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (transition) {
      const angle = Math.atan2(Math.sin(flight.heading - transition.yaw), Math.cos(flight.heading - transition.yaw));
      this.yaw = transition.yaw + angle * blend;
    } else this.yaw += dy * damp(this.mode === 'overhead' ? 0.35 : 1.2, dt);
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _r.set(-_f.z, 0, _f.x);

    let rate = 2.2;
    if (this.mode === 'overhead') {
      const h = (62 + 260 * this.intro) * z;
      _p.copy(g).addScaledVector(_f, 10 * z).setY(g.y + h);
      _l.copy(g).addScaledVector(_f, 12 * z);
      // diagonal framing: screen-up is the heading turned ~38 degrees
      _u.copy(_f).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -0.66);
      rate = 3;
    } else if (this.mode === 'chase') {
      _p.copy(g).addScaledVector(_f, -46 * z).setY(g.y + 15 * z);
      _l.copy(g).addScaledVector(_f, 70);
      _l.y = g.y - 6;
      _u.set(0, 1, 0).addScaledVector(_r, -flight.bank * 0.25).normalize();
    } else {
      this.orbitAngle += dt * 0.07;
      const a = this.orbitAngle, R = 70 * z;
      _p.set(g.x + Math.cos(a) * R, g.y + 18 * z, g.z + Math.sin(a) * R);
      _l.copy(g);
      _u.set(0, 1, 0);
      rate = 1.5;
    }
    if (transition) {
      // Translate the captured pose with the aircraft to avoid lagging behind it.
      const dx = g.x - transition.origin.x, dy = g.y - transition.origin.y, dz = g.z - transition.origin.z;
      this.pos.set(transition.pos.x + dx, transition.pos.y + dy, transition.pos.z + dz).lerp(_p, blend);
      this.look.set(transition.look.x + dx, transition.look.y + dy, transition.look.z + dz).lerp(_l, blend);
      this.up.copy(transition.up).lerp(_u, blend).normalize();
      if (t >= 1) this.overheadTransition = null;
    } else {
      const k = damp(rate, dt);
      this.pos.lerp(_p, k);
      this.look.lerp(_l, damp(rate * 1.6, dt));
      this.up.lerp(_u, damp(2.5, dt)).normalize();
    }
    // keep the camera above the waves
    this.pos.y = Math.max(this.pos.y, 6);

    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.up.copy(this.up);
    cam.lookAt(this.look);
  }
}
