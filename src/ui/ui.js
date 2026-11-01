// Thin DOM layer over index.html: no game logic here.
const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

export class UI {
  constructor() {
    this.el = {
      start: $('start'), begin: $('begin'), intro: $('intro'), veil: $('veil'), loading: $('loading'),
      sys: $('introSys'), pilot: $('introPilot'), ai: $('introAi'), log: $('introLog'), logText: $('introLogText'),
      subs: $('subs'), toast: $('toast'), toastIdx: $('toastIdx'), toastTitle: $('toastTitle'), toastArtist: $('toastArtist'),
      hud: $('hud'), hudFuel: $('hudFuel'), hudAlt: $('hudAlt'), hudClock: $('hudClock'), hudPlane: $('hudPlane'), hudMode: $('hudMode'),
      ending: $('ending'), endingFade: $('endingFade'), flyAgain: $('flyAgain'), endingCredits: $('endingCredits'),
      help: $('help'), info: $('infoBtn'), credits: $('credits'), creditsClose: $('creditsClose'), creditsTracks: $('creditsTracks'),
    };
    this.flightUi = false;   // HUD + info button allowed (after the intro)
    this.hidden = false;     // H key
    this._toastTimer = 0;
    this._subsTimer = 0;
    this._modeTimer = 0;
    this.el.endingCredits.onclick = () => this.toggleCredits(true);
    this.el.info.onclick = () => this.toggleCredits();
    this.el.creditsClose.onclick = () => this.toggleCredits(false);
    this.el.credits.onclick = (e) => { if (e.target === this.el.credits) this.toggleCredits(false); };
  }

  setEndingFade(amount) {
    this.el.endingFade.style.opacity = Math.max(0, Math.min(1, amount));
  }

  showEnding(onReplay) {
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
    this.el.flyAgain.focus({ preventScroll: true });
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
    for (const t of tracks) {
      const li = document.createElement('li');
      li.append(`${t.title} `);
      const a = document.createElement('span');
      a.textContent = `— ${t.artist}`;
      li.append(a);
      this.el.creditsTracks.append(li);
    }
  }

  enableFlightUi() {
    this.flightUi = true;
    if (matchMedia('(pointer: coarse)').matches) {
      this.el.help.innerHTML = '<span>Drag to steer and climb</span><span>Tap <kbd>i</kbd> for credits</span>';
    }
    this._applyVisibility();
    show(this.el.help, true);
    setTimeout(() => show(this.el.help, false), 14000);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this._applyVisibility();
    if (this.hidden) show(this.el.help, false);
  }

  toggleHelp() { show(this.el.help, this.el.help.classList.contains('hidden')); }

  _applyVisibility() {
    const on = this.flightUi && !this.hidden;
    show(this.el.hud, on);
    show(this.el.info, on);
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
    e.hudPlane.style.left = `${(fuelFrac * 100).toFixed(2)}%`;
  }

  flashMode(text) {
    const m = this.el.hudMode;
    m.textContent = text;
    clearTimeout(this._modeTimer);
    this._modeTimer = setTimeout(() => (m.textContent = ''), 2500);
  }
}
