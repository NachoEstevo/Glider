// A continuously running engine voice shared by the flight and comparison demo.
// Power is 0..1; selection fades the voice without restarting its sources.
export function createEngineAudio(ctx, output) {
  const nodes = [];
  const sources = [];
  const keep = node => { nodes.push(node); return node; };
  const master = keep(ctx.createGain());
  master.gain.value = 0;
  master.connect(output);

  // Crossfade independently generated stereo noise over the loop boundary.
  // Equal-power weights keep the airflow from audibly dipping each revolution.
  const length = Math.floor(ctx.sampleRate * 8);
  const overlap = Math.floor(ctx.sampleRate * 0.25);
  const loopLength = length - overlap;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
    for (let i = 0; i < overlap; i++) {
      const angle = (i / overlap) * Math.PI / 2;
      samples[i] = samples[loopLength + i] * Math.cos(angle) + samples[i] * Math.sin(angle);
    }
    samples[0] = samples[loopLength - 1];
  }
  const noise = keep(ctx.createBufferSource());
  noise.buffer = buffer;
  noise.loop = true;
  noise.loopEnd = loopLength / ctx.sampleRate;
  sources.push(noise);

  // Broad intake air gives the engine its main presence; a second, lower
  // resonance adds weight without making the voice sound like a pure tone.
  const airHighpass = keep(ctx.createBiquadFilter());
  airHighpass.type = 'highpass';
  airHighpass.frequency.value = 140;
  const airLowpass = keep(ctx.createBiquadFilter());
  airLowpass.type = 'lowpass';
  const airGain = keep(ctx.createGain());
  airGain.gain.value = 0;
  noise.connect(airHighpass).connect(airLowpass).connect(airGain).connect(master);

  const bodyFilter = keep(ctx.createBiquadFilter());
  bodyFilter.type = 'bandpass';
  bodyFilter.Q.value = 0.7;
  const bodyMotion = keep(ctx.createGain());
  bodyMotion.gain.value = 0.88;
  const bodyGain = keep(ctx.createGain());
  bodyGain.gain.value = 0;
  noise.connect(bodyFilter).connect(bodyMotion).connect(bodyGain).connect(master);

  // A small modulation of the noise suggests rotating machinery without an
  // obvious ticking sound. Its rate follows the same slow spool as the motor.
  const rotor = keep(ctx.createOscillator());
  const rotorDepth = keep(ctx.createGain());
  rotor.type = 'sine';
  rotorDepth.gain.value = 0.12;
  rotor.connect(rotorDepth).connect(bodyMotion.gain);
  sources.push(rotor);

  // Two quiet, slightly offset low fundamentals give the twin engines some
  // pitch and width while the filtered air remains the dominant character.
  const engines = [-0.4, 0.4].map((pan, side) => {
    const panner = keep(ctx.createStereoPanner());
    panner.pan.value = pan;
    panner.connect(master);
    const oscillator = keep(ctx.createOscillator());
    const gain = keep(ctx.createGain());
    oscillator.type = 'sine';
    gain.gain.value = 0;
    oscillator.connect(gain).connect(panner);
    sources.push(oscillator);
    return { oscillator, gain, detune: side ? 1.016 : 1 };
  });

  // A short, quiet air surge helps a large throttle increase feel physical.
  // Ordinary slider increments do not restart it.
  const surgeFilter = keep(ctx.createBiquadFilter());
  surgeFilter.type = 'bandpass';
  surgeFilter.frequency.value = 950;
  surgeFilter.Q.value = 0.8;
  const surgeGain = keep(ctx.createGain());
  surgeGain.gain.value = 0;
  noise.connect(surgeFilter).connect(surgeGain).connect(master);

  let disposed = false;
  let power = -1;
  let enabled = false;
  const target = (param, value, time, smoothing) => param.setTargetAtTime(value, time, smoothing);

  function setPower(value) {
    if (disposed) return;
    const next = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    if (next === power) return;
    const change = next - power;
    const now = ctx.currentTime;
    const spoolTime = change > 0 ? 0.85 : 1.15;
    if (enabled && power >= 0 && change >= 0.16) {
      surgeGain.gain.cancelScheduledValues(now);
      target(surgeGain.gain, Math.min(0.015, change * 0.021), now, 0.035);
      target(surgeGain.gain, 0, now + 0.09, 0.3);
    }
    power = next;
    const strength = 0.31 + 0.69 * Math.pow(power, 0.85);
    target(airLowpass.frequency, 1800 + 1600 * power, now, spoolTime);
    target(airGain.gain, 0.0305 * strength, now, 0.45);
    target(bodyFilter.frequency, 105 + 115 * power, now, spoolTime);
    target(bodyGain.gain, 0.0488 * strength, now, 0.6);
    target(rotor.frequency, 24 + 28 * power, now, spoolTime);
    for (const { oscillator, gain, detune } of engines) {
      target(oscillator.frequency, (48 + 58 * power) * detune, now, spoolTime);
      target(gain.gain, 0.00214 * strength, now, 0.6);
    }
  }

  function setEnabled(on) {
    if (disposed || !!on === enabled) return;
    enabled = !!on;
    target(master.gain, enabled ? 1 : 0, ctx.currentTime, 0.08);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const source of sources) source.stop();
    for (const node of nodes) node.disconnect();
    noise.buffer = null;
    sources.length = 0;
    nodes.length = 0;
    engines.length = 0;
  }

  setPower(0);
  for (const source of sources) source.start();
  return { setPower, setEnabled, dispose };
}
