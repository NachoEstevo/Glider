// Resize only after sustained frame pressure. Brief compilation, tab switches and
// individual shadow-map updates must not repeatedly recreate the render targets.
export class AdaptiveQuality {
  constructor({ resolution = 1, minResolution = 0.65, enabled = true } = {}) {
    this.enabled = enabled;
    this.resolution = this.maxResolution = resolution;
    this.minResolution = minResolution;
    this.averageMs = 18;
    this.elapsed = 0;
    this.pressure = 0;
    this.headroom = 0;
    this.lastChange = 0;
  }

  sample(frameMs) {
    if (!this.enabled || !Number.isFinite(frameMs) || frameMs <= 0) return null;
    if (frameMs > 100) {
      this.pressure = this.headroom = 0;
      return null;
    }
    const dt = frameMs / 1000;
    this.elapsed += dt;
    this.averageMs += (frameMs - this.averageMs) * (1 - Math.exp(-dt / 0.7));
    if (this.elapsed < 3) return null;
    this.pressure = this.averageMs > 22 ? this.pressure + dt : 0;
    this.headroom = this.averageMs < 19.5 ? this.headroom + dt : 0;
    if (this.elapsed - this.lastChange < 3) return null;
    const delta = this.pressure >= 1.5 ? -0.1 : this.headroom >= 6 ? 0.05 : 0;
    const next = Math.round(Math.max(this.minResolution, Math.min(this.maxResolution, this.resolution + delta)) * 100) / 100;
    if (next === this.resolution) return null;
    this.resolution = next;
    this.lastChange = this.elapsed;
    this.pressure = this.headroom = 0;
    return next;
  }
}
