const FALLBACK_DURATION = 2137;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

// Audio is authoritative once playing; simulation time is a fallback when it cannot start.
export class FlightSession {
  constructor(duration = FALLBACK_DURATION) {
    this.duration = duration;
    this.time = 0;
    this.fuelFraction = 1;
    this.ended = false;
  }

  update(dt, { audioTime, audioDuration, audioStarted = false, audioEnded = false } = {}) {
    if (Number.isFinite(audioDuration) && audioDuration > 0) this.duration = audioDuration;
    if (audioStarted) {
      if (Number.isFinite(audioTime)) this.time = Math.max(this.time, audioTime);
    } else {
      this.time += Math.max(0, Number.isFinite(dt) ? dt : 0);
    }
    this.fuelFraction = Math.min(this.fuelFraction, clamp(1 - this.time / this.duration, 0, 1));
    if (audioEnded) {
      this.time = Math.max(this.time, this.duration);
      this.fuelFraction = 0;
    }
    const shouldEnd = !this.ended && (audioEnded || this.fuelFraction <= 0);
    if (shouldEnd) this.ended = true;
    return { time: this.time, fuelFraction: this.fuelFraction, shouldEnd };
  }
}

// A quiet final glide, independent of the normal controls and autopilot.
export class FlightEnding {
  constructor() { this.elapsed = 0; this.fade = 0; this.finished = false; }

  begin(flight, rig) {
    this.elapsed = 0;
    this.fade = 0;
    this.finished = false;
    this.startZoom = rig.zoom;
    flight.throttle = 0;
  }

  update(dt, flight, rig) {
    dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 18 - this.elapsed));
    this.elapsed += dt;
    flight.update(dt, { gliding: true });
    rig.zoom = damp(rig.zoom, this.startZoom * 1.12, 0.12, dt);
    this.fade = clamp((this.elapsed - 12) / 6, 0, 1);
    this.finished = this.elapsed >= 18 - 1e-9;
    if (this.finished) this.fade = 1;
    return { finished: this.finished, fade: this.fade };
  }
}
