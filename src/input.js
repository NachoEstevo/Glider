// Keyboard, pointer drag (mouse or finger) and gamepad, folded into steer / climb / boost.
// One-shot actions (camera, hide UI, mute…) go to onAction.
const ACTIONS = { KeyC: 'camera', KeyH: 'hide', KeyM: 'mute', KeyI: 'credits', KeyF: 'fullscreen', Space: 'skip', Slash: 'help', Escape: 'escape' };

export class Input {
  constructor(target) {
    this.keys = new Set();
    this.drag = null;
    this.onAction = () => {};
    this.onZoom = () => {};
    this.state = { steer: 0, climb: 0, boost: false };

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
      if (ACTIONS[e.code] && !e.repeat) { this.onAction(ACTIONS[e.code]); if (e.code === 'Space') e.preventDefault(); }
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const s = Math.min(innerWidth, innerHeight) * 0.25;
      this.drag.dx = Math.max(-1, Math.min(1, (e.clientX - this.drag.x) / s));
      this.drag.dy = Math.max(-1, Math.min(1, (e.clientY - this.drag.y) / s));
    });
    const end = (e) => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('wheel', (e) => { this.onZoom(Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });
  }

  update() {
    const k = this.keys, s = this.state;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    // flight-sim convention: forward (W / up / stick up) noses down, back pulls up
    let climb = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    let boost = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.drag) { steer += this.drag.dx; climb += this.drag.dy; }
    const pad = navigator.getGamepads?.().find((p) => p);
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      steer += dz(pad.axes[0]);
      climb += dz(pad.axes[1]);
      boost ||= pad.buttons[7]?.pressed || pad.buttons[0]?.pressed;
    }
    s.steer = Math.max(-1, Math.min(1, steer));
    s.climb = Math.max(-1, Math.min(1, climb));
    s.boost = boost;
    return s;
  }
}
