// Thin DOM layer over index.html: no game logic here.
const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

export class UI {
  constructor() {
    this.el = {
      start: $('start'), begin: $('begin'), intro: $('intro'), veil: $('veil'), loading: $('loading'),
      audioControls: $('audioControls'), volume: $('volume'), volumeOutput: $('volumeOutput'),
      handover: $('handover'), handoverButton: $('handoverButton'),
      sys: $('introSys'), pilot: $('introPilot'), ai: $('introAi'), log: $('introLog'), logText: $('introLogText'),
      subs: $('subs'), toast: $('toast'), toastIdx: $('toastIdx'), toastTitle: $('toastTitle'), toastArtist: $('toastArtist'),
      hud: $('hud'), hudFuel: $('hudFuel'), hudAlt: $('hudAlt'), hudClock: $('hudClock'), hudFuelDot: $('hudFuelDot'), fuelGauge: $('fuelGauge'), hudMode: $('hudMode'),
      ending: $('ending'), endingFade: $('endingFade'), flyAgain: $('flyAgain'), endingCredits: $('endingCredits'),
      endingPanel: $('endingPanel'), endingRoll: $('endingRoll'), endingRollViewport: $('endingRollViewport'),
      endingContinue: $('endingContinue'), endingTracks: $('endingTracks'),
      help: $('help'), info: $('infoBtn'), credits: $('credits'), creditsClose: $('creditsClose'), creditsTracks: $('creditsTracks'),
    };
    this.musicRecovery = document.createElement('button');
    this.musicRecovery.type = 'button';
    this.musicRecovery.className = 'music-recovery hidden';
    document.body.append(this.musicRecovery);
    this.onVolumeChange = () => {};
    this.el.volume.oninput = () => this.onVolumeChange(Number(this.el.volume.value) / 100);
    this.flightUi = false;   // HUD + info button allowed (after the intro)
    this.hidden = false;     // H key
    this.helpHidden = false;
    this._toastTimer = 0;
    this._subsTimer = 0;
    this._modeTimer = 0;
    this.el.endingCredits.onclick = () => this.toggleCredits(true);
    this.el.info.onclick = () => this.toggleCredits();
    this.el.creditsClose.onclick = () => this.toggleCredits(false);
    this.el.credits.onclick = (e) => { if (e.target === this.el.credits) this.toggleCredits(false); };
  }

  setVolume(volume, muted) {
    const percent = Math.round(volume * 100);
    this.el.volume.value = percent;
    this.el.volumeOutput.textContent = muted ? 'Muted' : `${percent}%`;
  }

  setMusicState(state, onResume) {
    const visible = !this._endingShown && ['blocked', 'error', 'paused'].includes(state);
    this.musicRecovery.textContent = state === 'error' ? 'Retry music' : 'Resume music';
    this.musicRecovery.onclick = visible ? onResume : null;
    show(this.musicRecovery, visible);
  }

  setEndingFade(amount) {
    this.el.endingFade.style.opacity = Math.max(0, Math.min(1, amount));
  }

  showEnding(onReplay) {
    this._endingShown = true;
    show(this.musicRecovery, false);
    show(this.el.audioControls, false);
    this.flightUi = false;
    this._applyVisibility();
    show(this.el.help, false);
    this.el.toast.classList.remove('on');
    this.el.subs.classList.remove('on');
    this.toggleCredits(false);
    this._cursorAuto = false;
    document.body.classList.remove('no-cursor');
    this.el.flyAgain.onclick = onReplay;
    show(this.el.ending, true);
    show(this.el.endingPanel, false);
    show(this.el.endingRollViewport, true);
    const finish = () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      show(this.el.endingRollViewport, false);
      show(this.el.endingContinue, false);
      show(this.el.endingPanel, true);
      this.el.flyAgain.focus({ preventScroll: true });
    };
    let animation;
    const syncVisibility = () => {
      if (!animation) return;
      if (document.hidden) animation.pause(); else animation.play();
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.el.endingRollViewport.classList.add('reduced-motion');
      show(this.el.endingContinue, true);
      this.el.endingContinue.onclick = finish;
      this.el.endingRollViewport.focus({ preventScroll: true });
    } else {
      animation = this.el.endingRoll.animate([
        { transform: 'translateY(100dvh)' },
        { transform: 'translateY(-100%)' },
      ], { duration: 42000, easing: 'linear', fill: 'forwards' });
      document.addEventListener('visibilitychange', syncVisibility);
      syncVisibility();
      animation.finished.then(finish);
    }
  }

  showHandover(on, onAccept) {
    this.el.handoverButton.onclick = on ? onAccept : null;
    show(this.el.handover, on);
    if (on) this.el.handoverButton.focus({ preventScroll: true });
  }

  setLoading(text) {
    this.el.loading.textContent = text;
    show(this.el.loading, !!text);
  }

  ready(onBegin) {
    const b = this.el.begin;
    b.disabled = false;
    b.querySelector('.begin-label').textContent = 'Begin flight';
    b.focus({ preventScroll: true });
    b.onclick = () => { b.disabled = true; onBegin(); };
  }

  hideStart() {
    show(this.el.start, false);
    this._autoHideCursor();
  }

  // the cursor stays out of the picture over the flight (dragging steers without it); it
  // shows only over a control or while the credits are open
  _autoHideCursor() {
    const body = document.body;
    this._cursorAuto = true;
    const update = (e) => {
      const onControl = e?.target?.closest?.('button, a, input');
      body.classList.toggle('no-cursor', this._cursorAuto && !onControl && this.el.credits.classList.contains('hidden'));
    };
    addEventListener('mousemove', update);
    addEventListener('pointerdown', update);
    update();
  }

  // --- intro (black screen) ---
  showIntro(on) {
    show(this.el.intro, on);
    if (on) { this.setSys(false); this.el.log.classList.add('hidden'); }
  }
  setSys(on) { this.el.sys.style.opacity = on ? 1 : 0; }
  setPilot(text) { this._fadeText(this.el.pilot, text); }
  setAi(text) { this._fadeText(this.el.ai, text); }
  _fadeText(el, text) {
    if (text) { el.textContent = text; el.style.opacity = 1; } else el.style.opacity = 0;
  }
  showLog(on) { this.el.log.classList.toggle('hidden', !on); }
  setLog(text, progress) {
    this.el.logText.textContent = text;
    this.el.log.querySelector('.log-bar i').style.width = `${Math.round(progress * 100)}%`;
  }
  veil(on) { show(this.el.veil, on); }

  // --- over the flight ---
  subtitle(text, speaker, seconds) {
    const s = this.el.subs;
    s.innerHTML = '';
    const span = document.createElement('span');
    span.className = speaker;
    span.textContent = speaker === 'pilot' ? `“${text}”` : text;
    s.append(span);
    s.classList.add('on');
    clearTimeout(this._subsTimer);
    this._subsTimer = setTimeout(() => s.classList.remove('on'), seconds * 1000);
  }

  nowPlaying(track, index, total) {
    const e = this.el;
    e.toastIdx.textContent = `· ${index + 1}/${total}`;
    e.toastTitle.textContent = track.title;
    e.toastArtist.textContent = track.artist;
    e.toast.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => e.toast.classList.remove('on'), 8000);
    [...e.creditsTracks.children].forEach((li, i) => li.classList.toggle('now', i === index));
  }

  fillCredits(tracks) {
    this.el.creditsTracks.innerHTML = '';
    this.el.endingTracks.innerHTML = '';
    for (const t of tracks) {
      const li = document.createElement('li');
      li.append(`${t.title} `);
      const a = document.createElement('span');
      a.textContent = `— ${t.artist}`;
      li.append(a);
      this.el.creditsTracks.append(li);
      const line = document.createElement('p');
      line.textContent = `${t.title} — ${t.artist}`;
      this.el.endingTracks.append(line);
    }
  }

  enableFlightUi() {
    this.flightUi = true;
    if (matchMedia('(pointer: coarse)').matches) {
      this.el.help.innerHTML = '<span>Drag to steer and climb</span><span>Tap <kbd>i</kbd> for credits</span>';
    }
    this._applyVisibility();
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this._applyVisibility();
  }

  toggleHelp() {
    this.helpHidden = !this.helpHidden;
    this._applyVisibility();
  }

  _applyVisibility() {
    const on = this.flightUi && !this.hidden;
    show(this.el.hud, on);
    show(this.el.info, on);
    show(this.el.audioControls, !this.hidden && !this._endingShown);
    show(this.el.help, on && !this.helpHidden);
  }

  toggleCredits(force) {
    const open = force ?? this.el.credits.classList.contains('hidden');
    show(this.el.credits, open);
    document.body.classList.toggle('no-cursor', !open && !!this._cursorAuto);
    if (open) this.el.creditsClose.focus({ preventScroll: true });
    else if (!this.el.ending.classList.contains('hidden')) this.el.endingCredits.focus({ preventScroll: true });
  }

  hud({ fuel, fuelFrac, alt, speed, clock }) {
    const e = this.el;
    e.hudFuel.textContent = `FUEL ${fuel.toFixed(1)} GAL`;
    e.hudAlt.textContent = `ALT ${Math.round(alt)} M · ${Math.round(speed)} M/S`;
    e.hudClock.textContent = clock;
    e.hudFuelDot.style.left = `${(fuelFrac * 100).toFixed(2)}%`;
    e.fuelGauge.setAttribute('aria-valuenow', (fuelFrac * 100).toFixed(1));
    e.fuelGauge.setAttribute('aria-valuetext', `${fuel.toFixed(1)} gallons remaining`);
  }

  flashMode(text) {
    const m = this.el.hudMode;
    m.textContent = text;
    clearTimeout(this._modeTimer);
    this._modeTimer = setTimeout(() => (m.textContent = ''), 2500);
  }
}
