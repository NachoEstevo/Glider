const SAMPLE_URLS = [
  '/audio/sfx/wing_skim_slow.mp3',
  '/audio/sfx/wing_skim_loop.mp3',
  '/audio/sfx/wing_skim_fast.mp3',
];

// Crossfade the end into the beginning so a sustained contact has no loop click.
function prepareLoop(ctx, decoded) {
  const overlap = Math.min(Math.floor(decoded.sampleRate * 0.4), Math.floor(decoded.length / 4));
  if (overlap < 1) throw new Error('Wing water sample is too short');
  const length = decoded.length - overlap;
  const loop = ctx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
  let energy = 0, peak = 0;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const input = decoded.getChannelData(channel);
    const output = loop.getChannelData(channel);
    output.set(input.subarray(0, length));
    for (let i = 0; i < overlap; i++) {
      const angle = (i / overlap) * Math.PI / 2;
      output[i] = input[length + i] * Math.cos(angle) + input[i] * Math.sin(angle);
    }
    output[0] = output[length - 1];
    for (const value of output) {
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
  }
  const rms = Math.sqrt(energy / (length * decoded.numberOfChannels));
  // Preserve the sample's dynamics, with enough headroom for the rest of the mix.
  const level = rms && peak ? Math.min(1.5, 0.009 / rms, 0.2 / peak) : 0;
  return { loop, level };
}

// The same water texture is pre-stretched at three speeds to preserve pitch.
// Contact is retained during loading; the loops fade in once they are ready.
export function createWingWaterAudio(ctx, output) {
  const nodes = [];
  const keep = node => { nodes.push(node); return node; };
  const contact = keep(ctx.createGain());
  contact.gain.value = 0;
  const panner = keep(ctx.createStereoPanner());
  contact.connect(panner).connect(output);

  const abort = new AbortController();
  const clips = [];
  let disposed = false, amount = 0, side = 0, speed = 34;
  function applyContact() {
    const now = ctx.currentTime;
    contact.gain.setTargetAtTime(amount, now, amount > 0 ? 0.08 : 0.2);
    panner.pan.setTargetAtTime(side * 0.85, now, 0.12);
    const blend = speed <= 42 ? (speed - 20) / 22 : (speed - 42) / 33;
    const weights = speed <= 42 ? [1 - blend, blend, 0] : [0, 1 - blend, blend];
    clips.forEach((clip, i) => clip.gain.gain.setTargetAtTime(clip.level * weights[i], now, 0.35));
  }

  const ready = (async () => {
    try {
      const decoded = await Promise.all(SAMPLE_URLS.map(async url => {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok || disposed) throw new Error('Wing water sample unavailable');
        const bytes = await response.arrayBuffer();
        if (disposed) throw new Error('Wing water audio disposed');
        return ctx.decodeAudioData(bytes);
      }));
      if (disposed) return false;
      const loops = decoded.map(buffer => prepareLoop(ctx, buffer));
      for (const { loop, level } of loops) {
        const gain = keep(ctx.createGain());
        gain.gain.value = 0;
        const source = keep(ctx.createBufferSource());
        source.buffer = loop;
        source.loop = true;
        source.loopEnd = loop.length / loop.sampleRate;
        source.playbackRate.value = 1;
        source.connect(gain).connect(contact);
        clips.push({ source, gain, level });
      }
      const start = ctx.currentTime;
      for (const clip of clips) { clip.source.start(start); clip.started = true; }
      applyContact();
      return true;
    } catch {
      // The experience and music remain available if this optional effect fails.
      abort.abort();
      for (const clip of clips) {
        if (clip.started) clip.source.stop();
        clip.source.disconnect();
        clip.gain.disconnect();
        clip.source.buffer = null;
      }
      clips.length = 0;
      return false;
    }
  })();

  function update(strength, pan, velocity = 34) {
    if (disposed) return;
    amount = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
    side = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
    speed = Number.isFinite(velocity) ? Math.max(20, Math.min(75, velocity)) : 34;
    if (clips.length) applyContact();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    for (const clip of clips) if (clip.started) clip.source.stop();
    for (const node of nodes) node.disconnect();
    for (const clip of clips) clip.source.buffer = null;
    clips.length = 0;
    nodes.length = 0;
  }

  return { update, dispose, ready };
}
