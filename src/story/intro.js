// The opening, timed to the music like the video: a black cockpit screen where the pilot
// and the ship AI talk, the journal backup, then the world fades in and the last
// exchange plays over the flight. Space skips straight to flying.
export class Intro {
  constructor({ dialogue, soundtrack, ui, onReveal, onReady, onHandover }) {
    this.d = dialogue;
    this.sound = soundtrack;
    this.ui = ui;
    this.onReveal = onReveal;
    this.onHandover = onHandover;
    this.onReady = onReady;
    this.readyForHandover = false;
    this.played = new Set();
    this.revealed = false;
    this.done = false;
    this.clear = { pilot: 0, ai: 0 };
    this.log = null;
    this.gap = 0;         // breath after the current voice, seconds
    this.waitUntil = 0;   // story time a line without audio (not loaded) is assumed to take
  }

  begin() {
    this.ui.showIntro(true);
  }

  skip() {
    if (this.done) return;
    for (const l of this.d.lines) this.played.add(l.id);
    this.sound.stopVoice();
    this.ui.setPilot('');
    this.ui.setAi('');
    this._reveal();
    this._handover();
  }

  _reveal() {
    if (this.revealed) return;
    this.revealed = true;
    this.ui.showIntro(false);
    this.onReveal();
  }

  _handover() {
    if (this.done) return;
    this.done = true;
    this.onHandover();
  }

  update(t) {
    if (this.done) return;
    // one line at a time: a line waits for its time in the mix and for the previous voice
    // to really finish (audio clock, plus a breath), so lines never run into each other
    const idle = this.sound.voiceIdle(this.gap) && t >= this.waitUntil;
    for (const line of this.d.lines) {
      if (this.played.has(line.id)) continue;
      if (t < line.at || !idle) break;
      this.played.add(line.id);
      if (t > line.at + 12 && line.at < this.d.worldRevealAt) continue;   // seeked past the black intro: skip its lines
      this._say(line, t);
      break;
    }
    // hide finished lines
    for (const who of ['pilot', 'ai']) {
      if (this.clear[who] && t > this.clear[who]) {
        this.clear[who] = 0;
        if (!this.revealed) (who === 'pilot' ? this.ui.setPilot('') : this.ui.setAi(''));
      }
    }
    if (this.sysUntil && t > this.sysUntil) { this.sysUntil = 0; this.ui.setSys(false); }
    if (this.log) this._typeLog(t);

    if (!this.revealed && t >= this.d.worldRevealAt) this._reveal();
    const allSaid = this.played.size === this.d.lines.length && this.sound.voiceIdle();
    if (!this.readyForHandover && t >= this.d.handoverAt && allSaid) {
      this.readyForHandover = true;
      this.onReady();
    }
  }

  _say(line, t) {
    if (line.speaker === 'sys') {
      this.ui.setSys(true);
      this.sysUntil = line.at + (line.hold ?? 3);
      return;
    }
    const played = this.sound.playVoice(line.id);
    const dur = played || this.sound.duration(line.id);
    this.gap = line.speaker === 'ai' ? 0.9 : 0.6;
    this.waitUntil = played ? 0 : t + dur + this.gap;
    const text = line.display ?? line.text;
    if (line.kind === 'log') {
      this.ui.setPilot('');
      this.ui.setAi('');
      this.ui.showLog(true);
      this.log = { start: t, dur, text, end: t + dur + 5 };
      return;
    }
    if (this.revealed) {
      this.ui.subtitle(text, line.speaker, dur + 1.5);
      return;
    }
    if (line.speaker === 'pilot') { this.ui.setPilot(text); this.ui.setAi(''); } else this.ui.setAi(text);
    this.clear[line.speaker] = t + dur + (line.speaker === 'pilot' ? 3.5 : 4.5);
  }

  _typeLog(t) {
    const L = this.log, k = Math.min(1, (t - L.start) / Math.max(L.dur, 1));
    this.ui.setLog(L.text.slice(0, Math.floor(L.text.length * k)), k);
    if (t > L.end) { this.ui.showLog(false); this.log = null; }
  }
}
