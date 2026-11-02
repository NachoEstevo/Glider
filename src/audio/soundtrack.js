import { createWingWaterAudio } from './wingWaterAudio.js';
import { createEngineAudio } from './engineAudio.js';

// The playlist from the video as one continuous mix (it is the clock for the intro),
// the cockpit voices, and a synthesized bed of wind and sea under it all.
const MUSIC_SOURCES = [
  { src: '/audio/music/playlist.webm', type: 'audio/webm; codecs=opus' },
  { src: '/audio/music/playlist.m4a', type: 'audio/mp4' },
];
// everything that is not the music sits 30% lower
const FX_LEVEL = 0.7;
// on top of that: the water beds and splashes at a tenth, the gulls 20% down
const WATER_LEVEL = 0.1;
const GULL_LEVEL = 0.8;
const SFX = ['gull_1', 'gull_2', 'gull_3', 'gull_flock', 'lap_loop', 'surf_loop', 'island_loop', 'creak_1', 'creak_2', 'splash'];

export class Soundtrack {
  constructor({ tracks, dialogue }) {
    this.tracks = tracks;
    this.dialogue = dialogue;
    this.trackIndex = -1;
    this.onTrack = () => {};
    this.muted = false;
    this.volume = 1;
    try {
      const saved = localStorage.getItem('glider.volume');
      if (saved !== null && saved.trim() !== '' && Number.isFinite(Number(saved)))
        this.volume = Math.max(0, Math.min(1, Number(saved)));
    } catch { /* Storage may be unavailable in private or embedded contexts. */ }
    this.buffers = new Map();
    this.voiceEnd = 0;
    this.started = false;
    this.finishing = false;
    this.onMusicState = () => {};
    this._musicState = 'paused';
    this._hidden = false;
    this._resumeAfterVisibility = false;
    this._generation = 0;
    this._sourceIndex = -1;

    const el = (this.music = new Audio());
    el.loop = false;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const pick = MUSIC_SOURCES.find((s) => el.canPlayType(s.type)) ?? MUSIC_SOURCES[1];
    this._sourceIndex = MUSIC_SOURCES.indexOf(pick);
    el.src = pick.src;
    el.addEventListener('playing', () => { this._clearStall(); if (!this._hidden && !this.finishing && !this._retryPending) this._setMusicState('playing'); });
    el.addEventListener('pause', () => {
      if (!this._hidden && !this.finishing && !el.ended) this._setMusicState('paused');
    });
    el.addEventListener('ended', () => { this._clearStall(); this._generation++; this._setMusicState('ended'); });
    el.addEventListener('waiting', () => this._waitForMusic());
    el.addEventListener('stalled', () => this._waitForMusic());
    el.addEventListener('error', () => this._musicError());
  }

  get musicDiagnostic() {
    return { state: this._musicState, currentTime: this.music.currentTime,
      readyState: this.music.readyState, errorCode: this.music.error?.code ?? null };
  }

  _setMusicState(state) {
    if (this._musicState === state) return;
    this._musicState = state;
    this.onMusicState(state);
  }

  _clearStall() { clearTimeout(this._stallTimer); this._stallTimer = null; }

  _waitForMusic() {
    if (this._hidden || this.finishing || this.music.paused || this.music.ended || this._stallTimer) return;
    this._setMusicState('buffering');
    this._stallTimer = setTimeout(() => {
      this._stallTimer = null;
      if (!this._hidden && !this.finishing && !this.music.paused && !this.music.ended)
        this._setMusicState('blocked');
    }, 10000);
  }

  _musicError() {
    this._clearStall();
    if (this.finishing || this.music.ended || this._musicState === 'ended') return;
    if (!this._fallbackPending && !this._retryPending) this._recoveryTime = this.music.currentTime;
    this._cancelRetry?.();
    const next = MUSIC_SOURCES.findIndex((source, i) => i !== this._sourceIndex && this.music.canPlayType(source.type));
    if (next < 0 || this._triedFallback) { clearTimeout(this._fallbackTimer); this.music.removeEventListener('loadedmetadata', this._fallbackMetadata); this._fallbackPending = false; this._setMusicState('error'); return; }
    this._triedFallback = true;
    const shouldPlay = this._resumeAfterVisibility || (!this._hidden && (!this.music.paused || this._musicState === 'playing' || this._musicState === 'buffering'));
    this._fallbackPending = true;
    this._fallbackTimer = setTimeout(() => {
      if (this._fallbackPending && !this.finishing) {
        this._fallbackPending = false;
        this.music.removeEventListener('loadedmetadata', this._fallbackMetadata);
        this._setMusicState('error');
      }
    }, 10000);
    this._sourceIndex = next;
    this._setMusicState('buffering');
    this._fallbackMetadata = () => {
      if (!this._fallbackPending) return;
      this._fallbackPending = false;
      clearTimeout(this._fallbackTimer);
      if (this.finishing || this._musicState === 'ended') return;
      try { this.music.currentTime = this._recoveryTime; } catch { /* unavailable seek range */ }
      const resume = this._resumeRequested || (shouldPlay && this.started);
      this._resumeRequested = false;
      if (resume && !this._hidden) void this.resumeMusic();
      else if (resume) this._resumeAfterVisibility = true;
      else if (!this._hidden) this._setMusicState('paused');
    };
    this.music.addEventListener('loadedmetadata', this._fallbackMetadata, { once: true });
    this.music.src = MUSIC_SOURCES[next].src;
    this.music.load();
  }

  // Called from the start gesture; the audio graph is created exactly once.
  async start() {
    if (this.finishing || this.music.ended) return;
    if (this._starting) return this._starting;
    if (this.started) return;
    this._starting = this._start();
    try { await this._starting; } finally { this._starting = null; }
  }

  async _start() {
    if (!this.ctx) {
      const ctx = (this.ctx = new AudioContext());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0;
      ctx.createMediaElementSource(this.music).connect(this.musicGain).connect(this.master);
      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.value = 1.15 * FX_LEVEL;
      this.voiceGain.connect(this.master);
      this._ambience();
      this.musicGain.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
      this._loadVoices();
      this._loadSfx();
    }
    await this.resumeMusic();
  }

  async resumeMusic(position) {
    if (!this.ctx || this._hidden || this.finishing || this.music.ended || this._musicState === 'ended') return;
    if (Number.isFinite(position) && position >= 0) this._recoveryTime = position;
    if (this._fallbackPending) { this._resumeRequested = true; return; }
    if (this._musicState === 'error' || this._retryNeedsReload) return this._retryMusic();
    if (Number.isFinite(position) && position >= 0) {
      if (this.music.readyState < 1) return this._retryMusic(false);
      try { this.music.currentTime = position; } catch { return this._retryMusic(false); }
    }
    const generation = this._generation;
    this._playPending = true;
    try {
      await this.ctx.resume();
      if (generation !== this._generation || this._hidden || this.finishing) return;
      await this.music.play();
      if (generation !== this._generation || this._hidden || this.finishing) {
        if (this._hidden || this.finishing) this.music.pause();
        return;
      }
      this.started = true;
      this._setMusicState('playing');
      return true;
    } catch (error) {
      if (generation === this._generation && !this._hidden && !this.finishing)
        this._setMusicState(error?.name === 'NotAllowedError' ? 'blocked' : 'error');
    } finally {
      if (generation === this._generation) this._playPending = false;
    }
  }

  // Start playback in the gesture, then restore the saved position when metadata arrives.
  async _retryMusic(reload = true) {
    const generation = this._generation;
    const time = this._recoveryTime ?? this.music.currentTime;
    this._retryPending = true;
    this._retryNeedsReload = reload;
    this._setMusicState('buffering');
    let resolveMetadata;
    const metadata = new Promise(resolve => { resolveMetadata = resolve; });
    const cleanup = () => {
      clearTimeout(timer);
      this.music.removeEventListener('loadedmetadata', onMetadata);
      this._cancelRetry = null;
      this._retryPending = false;
    };
    const onMetadata = () => {
      try { this.music.currentTime = time; } catch { cleanup(); resolveMetadata(false); return; }
      cleanup(); resolveMetadata(true);
    };
    const timer = setTimeout(() => { cleanup(); resolveMetadata(false); }, 10000);
    this._cancelRetry = () => { cleanup(); resolveMetadata(false); };
    this.music.addEventListener('loadedmetadata', onMetadata, { once: true });
    try {
      if (reload) this.music.load();
      const context = this.ctx.resume();
      const play = this.music.play();
      const [seeked] = await Promise.race([
        Promise.all([metadata, context, play]),
        metadata.then(ok => ok ? new Promise(() => {}) : [false]),
      ]);
      if (!seeked || generation !== this._generation || this._hidden || this.finishing) {
        if (generation === this._generation && !this._hidden && !this.finishing) {
          this.music.pause(); this._setMusicState('error');
        }
        return;
      }
      this.started = true;
      this._recoveryTime = undefined;
      this._retryNeedsReload = false;
      this._setMusicState('playing');
      return true;
    } catch (error) {
      this._cancelRetry?.();
      if (generation === this._generation && !this._hidden && !this.finishing)
        this._setMusicState(error?.name === 'NotAllowedError' ? 'blocked' : 'error');
    }
  }

  async handleVisibility(hidden) {
    if (hidden === this._hidden) return;
    this._hidden = hidden;
    this._generation++;
    this._clearStall();
    try {
      if (hidden) {
        const retrying = this._retryPending;
        this._cancelRetry?.();
        if (retrying) this._setMusicState('error');
        this._resumeAfterVisibility = !retrying && !!this.ctx && !this.finishing && !this.music.ended &&
          (this.started || this._resumeRequested || this._playPending) &&
          (!this.music.paused || this._playPending || this._musicState === 'buffering' || this._musicState === 'playing');
        this._playPending = false;
        this.music.pause();
        if (this.ctx) await this.ctx.suspend();
      } else if (this._resumeAfterVisibility && !this.finishing && !this.music.ended) {
        if (!this._fallbackPending) {
          this._resumeAfterVisibility = false;
          await this.resumeMusic();
        }
      } else if (this.started && !this.finishing && this.ctx) {
        await this.ctx.resume();
      }
    } catch {
      if (!this._hidden && !this.finishing) this._setMusicState('blocked');
    }
  }

  // --- world sounds (generated with ElevenLabs, tools/generate_sfx.py) -------------------
  async _loadSfx() {
    const ctx = this.ctx;
    this.sfx = new Map();
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0;
    this.sfxBus.connect(this.master);
    // a touch of space so the one-shots sit in the air, not in your ear
    const verb = ctx.createConvolver();
    verb.buffer = this._room(2.6);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.35;
    this.verbSend.connect(verb).connect(this.sfxBus);
    await Promise.all(SFX.map(async (id) => {
      try {
        const res = await fetch(`/audio/sfx/${id}.mp3`);
        this.sfx.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn('sfx', id, e);
      }
    }));
    this.loops = {};
    for (const id of ['lap_loop', 'surf_loop', 'island_loop']) {
      const b = this.sfx.get(id);
      if (!b) continue;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.loopStart = 0.05;                 // skip the mp3 encoder padding at both ends
      s.loopEnd = b.duration - 0.05;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(g).connect(this.sfxBus);
      s.start(ctx.currentTime, Math.random() * b.duration * 0.8);
      this.loops[id] = g;
    }
    this.nextGull = ctx.currentTime + 3;
    this.nextCreak = ctx.currentTime + 20;
    this.nextSplash = ctx.currentTime + 12;
    this.sfxBus.gain.setTargetAtTime(FX_LEVEL, ctx.currentTime, 2);
  }

  // decaying stereo noise: an outdoor-ish reverb tail
  _room(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5) * 0.5;
    }
    return b;
  }

  // a one-shot placed left/right and far/near
  _shot(id, { pan = 0, gain = 1, rate = 1 } = {}) {
    const b = this.sfx?.get(id);
    if (!b) return;
    const ctx = this.ctx, s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(g).connect(p);
    p.connect(this.sfxBus);
    p.connect(this.verbSend);
    s.start();
  }

  // env: { city, shore, land, low } all 0..1, gulls: [{ pan, dist }] near the glider
  _world(env, throttle, enginePower) {
    const ctx = this.ctx, t = ctx.currentTime, L = this.loops;
    const set = (id, v, tc = 1.2) => L[id]?.gain.setTargetAtTime(v, t, tc);
    set('lap_loop', 0.9 * WATER_LEVEL * env.city * env.low);
    set('surf_loop', 0.85 * WATER_LEVEL * env.shore * (0.35 + 0.65 * env.low));
    set('island_loop', 0.7 * env.land * (0.3 + 0.7 * env.low));
    // gulls call now and then from wherever they are
    if (t > this.nextGull) {
      const near = env.gulls.length ? env.gulls[Math.floor(Math.random() * env.gulls.length)] : null;
      if (near && near.dist < 160) {
        const id = ['gull_1', 'gull_2', 'gull_3'][Math.floor(Math.random() * 3)];
        this._shot(id, { pan: near.pan, gain: GULL_LEVEL * Math.min(1, 40 / (near.dist + 15)), rate: 0.92 + Math.random() * 0.16 });
      } else if (env.city > 0.3 || env.shore > 0.3) {
        this._shot('gull_flock', { pan: Math.random() * 1.6 - 0.8, gain: 0.5 * GULL_LEVEL });
      }
      this.nextGull = t + 5 + Math.random() * 11;
    }
    if (env.city > 0.4 && t > this.nextCreak) {
      this._shot(Math.random() < 0.5 ? 'creak_1' : 'creak_2', { pan: Math.random() * 1.6 - 0.8, gain: 0.55 * env.low + 0.15, rate: 0.85 + Math.random() * 0.2 });
      this.nextCreak = t + 18 + Math.random() * 30;
    }
    if (env.low > 0.6 && t > this.nextSplash) {
      this._shot('splash', { pan: Math.random() * 1.6 - 0.8, gain: 0.45 * WATER_LEVEL });
      this.nextSplash = t + 14 + Math.random() * 25;
    }
  }

  async _loadVoices() {
    await Promise.all(this.dialogue.lines.filter((l) => l.speaker !== 'sys').map(async (l) => {
      try {
        const res = await fetch(`/audio/voice/${l.id}.mp3`);
        this.buffers.set(l.id, await this.ctx.decodeAudioData(await res.arrayBuffer()));
      } catch (e) {
        console.warn('voice', l.id, e);
      }
    }));
  }

  // filtered noise: a high airy wind that follows speed, a low swell wash beneath
  _ambience() {
    const ctx = this.ctx, len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {   // pink-ish noise (Paul Kellet, economy)
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      }
    }
    const noise = (rate) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise(1).connect(this.windFilter).connect(this.windGain).connect(this.master);

    const sea = ctx.createBiquadFilter();
    sea.type = 'lowpass';
    sea.frequency.value = 380;
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0;
    const swell = ctx.createOscillator();   // slow breathing of the wash
    swell.frequency.value = 0.09;
    const depth = ctx.createGain();
    depth.gain.value = 0.05 * FX_LEVEL * WATER_LEVEL;
    swell.connect(depth).connect(this.seaGain.gain);
    swell.start();
    noise(0.7).connect(sea).connect(this.seaGain).connect(this.master);

    this.wingWater = createWingWaterAudio(ctx, this.master);
    const engineGain = ctx.createGain();
    engineGain.gain.value = 1.275; // approved engine level, including the 15% reduction
    engineGain.connect(this.master);
    this.engine = createEngineAudio(ctx, engineGain);
  }

  // Called once per frame with the filtered wake contact. The sources never restart.
  setWingWaterContact(strength, pan, speed = 34) {
    if (!this.ctx || !this.wingWater || this.finishing) return;
    this.wingWater.update(strength, pan, speed);
  }

  get time() { return this.music.currentTime; }

  stopVoice() {
    try { this.voiceSource?.stop(); } catch { /* already ended */ }
    if (this.ctx) this.voiceEnd = this.ctx.currentTime;
  }

  // true once the last voice has finished (on the audio clock) and `gap` seconds passed
  voiceIdle(gap = 0) {
    return !this.ctx || this.ctx.currentTime >= this.voiceEnd + gap;
  }

  playVoice(id) {
    const b = this.buffers.get(id);
    if (!b || !this.ctx) return 0;
    // never two voices at once
    try { this.voiceSource?.stop(); } catch { /* already ended */ }
    const s = (this.voiceSource = this.ctx.createBufferSource());
    s.buffer = b;
    s.connect(this.voiceGain);
    s.start();
    this.voiceEnd = this.ctx.currentTime + b.duration;
    // duck the music under the voice
    const g = this.musicGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.5, t, 0.25);
    g.setTargetAtTime(0.9, t + b.duration + 0.2, 1.0);
    return b.duration;
  }

  duration(id) { return this.buffers.get(id)?.duration ?? 3; }

  // speed01: 0 cruise .. 1 boost; altitude in metres; env: see _world
  update(speed01, altitude, env, enginePower = 1) {
    if (!this.ctx || this.finishing) return;
    this.engine?.setPower(speed01 * enginePower);
    this.engine?.setEnabled(enginePower > 0);
    const t = this.ctx.currentTime, low = Math.max(0, 1 - altitude / 160);
    this.windGain.gain.setTargetAtTime((0.05 + 0.16 * speed01) * FX_LEVEL, t, 0.4);
    this.windFilter.frequency.setTargetAtTime(450 + 900 * speed01, t, 0.6);
    this.seaGain.gain.setTargetAtTime((0.03 + 0.12 * low * (1 - 0.6 * (env?.land ?? 0))) * FX_LEVEL * WATER_LEVEL, t, 0.8);
    if (env && this.loops) this._world(env, speed01, enginePower);

    const now = this.music.currentTime;
    let i = 0;
    while (i + 1 < this.tracks.length && now >= this.tracks[i + 1].start) i++;
    if (i !== this.trackIndex) {
      this.trackIndex = i;
      this.onTrack(this.tracks[i], i);
    }
  }

  finish(seconds = 6) {
    if (this.finishing) return;
    this.engine?.setEnabled(false);
    this.wingWater?.update(0, 0);
    this.finishing = true;
    this._generation++;
    this._clearStall();
    clearTimeout(this._fallbackTimer);
    this._cancelRetry?.();
    this.music.removeEventListener('loadedmetadata', this._fallbackMetadata);
    this._setMusicState('ended');
    if (!this.ctx) return;
    const gain = this.master.gain, now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + Math.max(0.01, seconds));
  }

  setVolume(volume) {
    if (!Number.isFinite(volume)) return;
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = false;
    try { localStorage.setItem('glider.volume', String(this.volume)); } catch { /* Optional preference. */ }
    if (this.ctx && !this.finishing) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && !this.finishing) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.15);
    return this.muted;
  }
}
