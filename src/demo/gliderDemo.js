import * as THREE from 'three';
import { createGlider } from '../glider/gliderModel.js';
import { worldHeight } from '../world/worldHeight.js';
import { createEngineAudio } from '../audio/engineAudio.js';
import { createWingWaterAudio } from '../audio/wingWaterAudio.js';
import './gliderDemo.css';

// An opt-in study using the real ocean and sky, with isolated engine audio.
export function mountGliderDemo(app, selectModel) {
  const original = app.glider;
  const refined = createGlider({ detail: 'refined' });
  refined.root.visible = false;
  app.scene.add(refined.root);
  const state = { model: 'refined', audio: 'layered', preset: 'cruise', view: 'intake', power: .35, volume: app.sound.volume, sound: false };
  selectModel(refined);
  const centre = new THREE.Vector3(-3700, 0, -1600);
  for (const [x, z] of [[-3700,-1600],[-3500,-2100],[-3000,2200],[3800,-1800]]) {
    if (Array.from({ length: 24 }, (_, i) => {
      const a = i * Math.PI / 12;
      return worldHeight(x + Math.cos(a) * 160, z + Math.sin(a) * 160) < -2;
    }).every(Boolean)) { centre.set(x, 0, z); break; }
  }
  let angle = 0, altitude = 42, bank = .08, speed = 42;
  app.flight.autopilot = false;
  app.rig.intro = 0;
  app.rig.zoom = .68;
  app.flight.update = dt => {
    const skim = state.preset === 'skim';
    speed = THREE.MathUtils.damp(speed, 24 + 52 * state.power, .7, dt);
    angle += speed / 155 * dt;
    altitude = THREE.MathUtils.damp(altitude, skim ? 6.9 : 42, skim ? .9 : .7, dt);
    bank = THREE.MathUtils.damp(bank, skim ? .66 : .08, 1.4, dt);
    app.flight.pos.set(centre.x + Math.cos(angle) * 155, altitude, centre.z + Math.sin(angle) * 155);
    app.flight.heading = -angle;
    app.flight.bank = bank;
    app.flight.pitch = 0;
    app.flight.speed = speed;
    app.flight.throttle = state.power;
    applyAudio();
  };
  const rigUpdate = app.rig.update.bind(app.rig);
  const cameraPos = new THREE.Vector3(), look = new THREE.Vector3();
  let firstView = true;
  app.rig.update = (flight, dt) => {
    if (state.view !== 'intake' && state.view !== 'exhaust') { rigUpdate(flight, dt); return; }
    const s = Math.sin(flight.heading), c = Math.cos(flight.heading);
    cameraPos.set(flight.pos.x + s * 29 + c * 12, flight.pos.y + 8, flight.pos.z + c * 29 - s * 12);
    look.set(flight.pos.x - s, flight.pos.y, flight.pos.z - c);
    if (state.view === 'exhaust') {
      app.glider.body.updateWorldMatrix(true, false);
      app.glider.body.localToWorld(cameraPos.set(5.5, 1.4, -17));
      app.glider.body.localToWorld(look.set(2.55, -.42, -6.6));
    }
    if (firstView) { app.camera.position.copy(cameraPos); firstView = false; }
    else app.camera.position.lerp(cameraPos, 1 - Math.exp(-2.5 * dt));
    app.camera.up.set(0, 1, 0);
    app.camera.lookAt(look);
    // Other views must ease from this actual pose, not the rig's old location.
    app.rig.pos.copy(app.camera.position);
    app.rig.look.copy(look);
    app.rig.up.copy(app.camera.up);
    app.rig.yaw = flight.heading;
    app.rig.lastMode = state.view;
    app.rig.overheadTransition = null;
  };

  const panel = document.createElement('section');
  panel.className = 'glider-study';
  panel.setAttribute('aria-label', 'Glider comparison demo');
  panel.innerHTML = `<p class="study-kicker">PROPULSION · STUDY 01</p><h1>Glider, refined.</h1>
    <p class="study-intro">Compare the turbine, its voice, and the wing meeting the sea.</p>
    <fieldset><legend>Aircraft</legend><button data-model="current">Current</button><button data-model="refined" aria-pressed="true">Refined</button></fieldset>
    <fieldset><legend>Engine sound</legend><button data-audio="original">Original</button><button data-audio="layered" aria-pressed="true">Layered</button></fieldset>
    <label>Power <output id="studyPower">35%</output><input id="studyPowerInput" type="range" min="0" max="100" value="35"></label>
    <fieldset><legend>Pass</legend><button data-preset="cruise" aria-pressed="true">Cruise</button><button data-preset="full">Full power</button><button data-preset="skim">Wing skim</button></fieldset>
    <fieldset><legend>Camera</legend><button data-view="intake" aria-pressed="true">Intake</button><button data-view="exhaust">Nozzle</button><button data-view="orbit">Orbit</button><button data-view="chase">Chase</button><button data-view="overhead">Above</button></fieldset>
    <button id="studySound" class="study-sound">Enable sound</button>
    <label>Volume <output id="studyVolume">${Math.round(state.volume * 100)}%</output><input id="studyVolumeInput" type="range" min="0" max="100" value="${Math.round(state.volume * 100)}"></label>
    <p id="studyStatus" class="study-status" role="status">Engine comparison · wing-water contact · no music</p><a href="/">Return to the experience ↗</a>`;
  document.body.append(panel);
  let ctx, master, originalGain, refinedGain, originalSource, layered, wingWater, disposed = false, starting;
  const $ = selector => panel.querySelector(selector);
  const select = (key, value) => {
    state[key] = value;
    panel.querySelectorAll(`[data-${key}]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[key] === value)));
  };
  panel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.model) { select('model', button.dataset.model); selectModel(state.model === 'refined' ? refined : original); }
    if (button.dataset.audio) { select('audio', button.dataset.audio); applyAudio(); }
    if (button.dataset.view) { select('view', button.dataset.view); if (state.view !== 'intake' && state.view !== 'exhaust') app.rig.mode = state.view; }
    if (button.dataset.preset) {
      select('preset', button.dataset.preset);
      setPower(state.preset === 'full' ? .9 : .35);
      if (state.preset === 'skim') { select('view', 'chase'); app.rig.mode = 'chase'; }
    }
  });
  function setPower(value) {
    state.power = value;
    $('#studyPowerInput').value = Math.round(value * 100);
    $('#studyPower').textContent = `${Math.round(value * 100)}%`;
    applyAudio();
  }
  $('#studyPowerInput').oninput = event => setPower(Number(event.target.value) / 100);
  $('#studyVolumeInput').oninput = event => {
    state.volume = Number(event.target.value) / 100;
    app.sound.setVolume(state.volume);
    $('#studyVolume').textContent = `${Math.round(state.volume * 100)}%`;
    if (master) master.gain.setTargetAtTime(state.sound ? state.volume : 0, ctx.currentTime, .1);
  };
  function applyAudio() {
    if (!ctx || !layered || disposed) return;
    originalGain.gain.setTargetAtTime(state.audio === 'original' ? .85 * .7 * (.1 + .32 * state.power) : 0, ctx.currentTime, .12);
    layered.setPower(state.power);
    layered.setEnabled(state.audio === 'layered');
  }
  async function startAudio() {
    if (ctx) { await ctx.resume(); return; }
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    originalGain = ctx.createGain(); originalGain.gain.value = 0; originalGain.connect(master);
    refinedGain = ctx.createGain(); refinedGain.gain.value = 1.275; refinedGain.connect(master);
    layered = createEngineAudio(ctx, refinedGain);
    wingWater = createWingWaterAudio(ctx, master);
    await ctx.resume();
    if (!await wingWater.ready) throw new Error('Could not load the wing-water recording');
    const response = await fetch('/audio/sfx/engine_loop.mp3');
    if (!response.ok) throw new Error('Could not load the original engine');
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (disposed) return;
    originalSource = ctx.createBufferSource(); originalSource.buffer = buffer; originalSource.loop = true;
    originalSource.loopStart = .05; originalSource.loopEnd = Math.max(.06, buffer.duration - .05);
    originalSource.connect(originalGain); originalSource.start();
    applyAudio();
  }
  $('#studySound').onclick = async () => {
    if (starting) return;
    $('#studySound').disabled = true;
    try {
      starting = startAudio(); await starting;
      if (disposed) return;
      state.sound = !state.sound;
      master.gain.setTargetAtTime(state.sound ? state.volume : 0, ctx.currentTime, .1);
      $('#studySound').textContent = state.sound ? 'Mute sound' : 'Enable sound';
      $('#studyStatus').textContent = 'Engine comparison · wing-water contact · no music';
    } catch {
      $('#studyStatus').textContent = 'Audio could not load. Try enabling sound again.';
      layered?.dispose(); wingWater?.dispose(); originalSource?.stop(); await ctx?.close().catch(() => {});
      ctx = master = layered = wingWater = originalSource = undefined;
    } finally { starting = null; $('#studySound').disabled = false; }
  };
  const visibility = () => { if (ctx) void (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {}); };
  document.addEventListener('visibilitychange', visibility);
  const restore = () => visibility();
  addEventListener('pageshow', restore);
  addEventListener('pagehide', event => {
    if (event.persisted) { if (ctx) void ctx.suspend().catch(() => {}); return; }
    disposed = true;
    document.removeEventListener('visibilitychange', visibility);
    removeEventListener('pageshow', restore);
    layered?.dispose(); wingWater?.dispose(); originalSource?.stop(); void ctx?.close();
  });
  return {
    state, setPower,
    setWingWaterContact(strength, pan, speed) { wingWater?.update(strength, pan, speed); },
    onAction(action) {
      if (action === 'mute') $('#studySound').click();
      if (action === 'hide') panel.hidden = !panel.hidden;
      if (action === 'camera') {
        const views = ['intake', 'exhaust', 'orbit', 'chase', 'overhead'];
        $(`[data-view="${views[(views.indexOf(state.view) + 1) % views.length]}"]`).click();
      }
    },
    get context() { return ctx; }, get master() { return master; },
  };
}
