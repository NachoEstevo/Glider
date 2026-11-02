import * as THREE from 'three';
import { OceanSim, defaultOceanParams } from './water/OceanSim.js';
import { OceanSurface } from './water/OceanSurface.js';
import { bakeShoreMap } from './water/shoreMap.js';
import { bakeWaterTextures } from './water/bakeTextures.js';
import { WaveCaustics } from './water/Caustics.js';
import { Spray } from './water/Spray.js';
import { WingWake } from './water/WingWake.js';
import { SkySystem } from './scene/sky.js';
import { createTerrain } from './scene/terrain.js';
import { FloaterShadow } from './scene/floaterShadow.js';
import { PlanarReflection } from './engine/PlanarReflection.js';
import { PostFX } from './engine/PostFX.js';
import { worldHeight, WORLD_SIZE, CITIES, cityMask } from './world/worldHeight.js';
import { planRuins, buildRuins } from './world/ruins.js';
import { createVegetation } from './world/vegetation.js';
import { planLandmarks, buildLandmarks, landmarkTops } from './world/landmarks.js';
import { Birds } from './world/birds.js';
import { createGlider, CASTER_LAYER } from './glider/gliderModel.js';
import { Flight } from './glider/flight.js';
import { CameraRig } from './glider/cameraRig.js';
import { Trails } from './glider/trails.js';
import { Input } from './input.js';
import { Soundtrack } from './audio/soundtrack.js';
import { UI } from './ui/ui.js';
import { Intro } from './story/intro.js';
import { FlightSession, FlightEnding } from './story/ending.js';
import { AdaptiveQuality } from './engine/AdaptiveQuality.js';

const REFLECT_LAYER = 1;
const args = new URLSearchParams(location.search);
const DEV = args.has('dev');   // straight into the flight, no audio (for tuning)
const GLIDER_DEMO = args.get('demo') === 'glider';
const PREVIEW_ENDING = args.get('preview') === 'ending';
const ui = new UI();
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)));

const renderer = new THREE.WebGLRenderer({ antialias: false, depth: false, stencil: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

const mobile = args.has('mobile') || (!args.has('desktop') && matchMedia('(pointer: coarse)').matches);
const quality = mobile
  ? { resolution: 0.6, msaa: 2, reflections: true, reflectionScale: 0.35 }
  : { resolution: 1, msaa: 4, reflections: true, reflectionScale: 0.5 };
const adaptive = new AdaptiveQuality({ resolution: quality.resolution, minResolution: mobile ? 0.4 : 0.65 });
const metrics = { frame: 0, frameMs: 0, cpuMs: 0, drawCalls: 0, triangles: 0, shadowUpdates: 0 };
const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 80000);

async function main() {
  ui.setLoading('');
  const [tracksData, dialogue] = await Promise.all(['/data/tracks.json', '/data/dialogue.json'].map((u) => fetch(u).then((r) => r.json())));
  ui.fillCredits(tracksData.tracks);
  await nextFrame();

  // --- world ----------------------------------------------------------------------
  const ruinPlan = planRuins();
  const landmarkPlan = planLandmarks();
  const landmarks = buildLandmarks(landmarkPlan);   // geometry first: its footprints feed the shore map
  const lmTops = landmarkTops(landmarkPlan);
  const obstacleTop = (x, z) => Math.max(ruinPlan.flightTopAt(x, z), lmTops.topAt(x, z));
  const sky = new SkySystem(renderer);
  Object.assign(sky.params, { elevation: 42, azimuth: 205, cloudCoverage: 0.34, turbidity: 2.4 });
  // the shore map sees the roofs that break the surface, so foam wraps around them
  const shore = bakeShoreMap((x, z) => Math.max(worldHeight(x, z), ruinPlan.topAt(x, z), lmTops.wetTopAt(x, z)), WORLD_SIZE, 1536);
  await nextFrame();
  const tex = bakeWaterTextures(renderer);
  const ocean = new OceanSim(renderer, { ...defaultOceanParams(), windSpeed: 10 });
  const caustics = new WaveCaustics(renderer, ocean);
  const casterShadow = new FloaterShadow(1024, CASTER_LAYER);
  const surface = new OceanSurface(ocean, shore, sky, casterShadow.uniforms);
  surface.uniforms.uFoamTex.value = tex.foam;
  const su = surface.uniforms;
  // turquoise shallows and deep blue channels (between Ultra-Water's clear and tropical)
  su.uAbsorption.value.set(0.40, 0.06, 0.045);
  su.uScatterColor.value.setRGB(0.0, 0.07, 0.1);
  su.uFoamTint.value.set(0.66, 0.86, 0.84);
  su.uCamSide.value = -1;
  su.uFoam.value.x = 0.18;   // a scatter of whitecaps, read from above like the video
  su.uFoam.value.y = 1.6;

  const scene = new THREE.Scene();
  scene.environment = sky.cube;
  scene.add(sky.background);
  const terrain = createTerrain({
    sky, caustics: caustics.uniforms, floatShadow: casterShadow.uniforms, water: su,
    absorption: su.uAbsorption.value, reflectionLayer: REFLECT_LAYER,
  });
  scene.add(terrain.group);
  terrain.uniforms.uCausticStrength.value = 0.35;   // full strength reads as grain from flying height
  const ruins = buildRuins(ruinPlan, terrain.patchCustom);
  const trees = createVegetation(terrain.patchCustom, ruinPlan);
  landmarks.traverse((c) => { if (c.isMesh) c.material = ruins.userData.material; });
  for (const o of [ruins, trees, landmarks]) { o.traverse((c) => c.layers.enable(REFLECT_LAYER)); scene.add(o); }
  await nextFrame();

  // sun: the static shadow map (terrain, ruins, trees) re-centres on the glider in steps
  const sunLight = new THREE.DirectionalLight(0xffffff, Math.PI);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(mobile ? 2048 : 4096, mobile ? 2048 : 4096);
  Object.assign(sunLight.shadow.camera, { left: -420, right: 420, top: 420, bottom: -420, near: 10, far: 5000 });
  sunLight.shadow.bias = -0.00008;
  sunLight.shadow.normalBias = 0.12;
  scene.add(sunLight, sunLight.target);
  su.uShadowMatrix.value = terrain.uniforms.uSunShadowMatrix.value = sunLight.shadow.matrix;
  su.uShadowBias.value = 0.05 / (sunLight.shadow.camera.far - sunLight.shadow.camera.near);
  const shadowCentre = new THREE.Vector3(Infinity, 0, 0);

  const reflection = new PlanarReflection(REFLECT_LAYER);
  su.uReflMatrix.value = reflection.textureMatrix;
  const waterScene = new THREE.Scene();
  const spray = new Spray(surface, shore);
  const wingWake = new WingWake(surface);
  waterScene.add(surface.mesh, spray.mesh, spray.splash, wingWake.group);

  const post = new PostFX(renderer);
  Object.assign(post.params, { bloomStrength: mobile ? 0 : 0.035, bloomThreshold: 1.5, contrast: 1.04, saturation: 1.07, keyValue: 0.2 });

  // --- the glider and its company --------------------------------------------------
  let glider = createGlider({ detail: GLIDER_DEMO ? 'current' : 'refined' });
  scene.add(glider.root);
  const trails = new Trails();
  scene.add(trails.group);
  const start = CITIES[0];
  const flight = new Flight({ start: new THREE.Vector3(start.x - 300, 75, start.z - 420), heading: 0.62, obstacleTop });
  flight.speedScale = 0.75;
  const birds = new Birds(9);
  scene.add(birds.group);
  birds.place(flight);
  const rig = new CameraRig(camera);
  rig.intro = 1;
  flight.applyTo(glider);
  rig.snap(flight);

  // --- render targets ---------------------------------------------------------------
  let hdrRT = null;
  function makeTargets() {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    hdrRT?.dispose();
    hdrRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, samples: quality.msaa, generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(size.x, size.y, THREE.FloatType),
    });
    su.uSceneColor.value = hdrRT.texture;
    su.uSceneDepth.value = hdrRT.depthTexture;
    su.uResolution.value.copy(size);
    reflection.scale = quality.reflectionScale;
    reflection.setSize(size.x, size.y);
    post.setSize(size.x, size.y);
  }
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 1.75) * quality.resolution);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    makeTargets();
  }
  addEventListener('resize', resize);
  resize();

  function applySun() {
    sky.update();
    sunLight.color.setRGB(sky.sunColor.x, sky.sunColor.y, sky.sunColor.z).multiplyScalar(1 / Math.max(sky.sunColor.x, 1e-4));
    sunLight.intensity = Math.PI * Math.max(sky.sunColor.x, 1e-4);
    shadowCentre.set(Infinity, 0, 0);
  }
  applySun();

  function followShadow() {
    const snap = 100, c = new THREE.Vector3(Math.round(flight.pos.x / snap) * snap, 0, Math.round(flight.pos.z / snap) * snap);
    if (c.distanceTo(shadowCentre) < 1) return;
    // land the centre on whole shadow texels across the light's view, so a re-centre doesn't
    // slide every shadow edge by a fraction of a texel (they shimmered at each step)
    const sc = sunLight.shadow.camera, texel = (sc.right - sc.left) / sunLight.shadow.mapSize.x;
    const z = sky.sunDir.clone().normalize(), right = new THREE.Vector3(0, 1, 0).cross(z).normalize(), up = z.clone().cross(right);
    const r = c.dot(right), u = c.dot(up);
    c.addScaledVector(right, Math.round(r / texel) * texel - r).addScaledVector(up, Math.round(u / texel) * texel - u);
    shadowCentre.copy(c);
    sunLight.target.position.copy(c);
    sunLight.position.copy(c).addScaledVector(sky.sunDir, 2000);
    sunLight.target.updateMatrixWorld();
    sunLight.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }

  // --- audio, story, input ---------------------------------------------------------
  const sound = new Soundtrack({ tracks: tracksData.tracks, dialogue });
  ui.onVolumeChange = (volume) => { sound.setVolume(volume); ui.setVolume(sound.volume, sound.muted); };
  ui.setVolume(sound.volume, sound.muted);
  const session = new FlightSession();
  const ending = new FlightEnding();
  let progress = { time: 0, fuelFraction: 1 };
  let audioFading = false;
  // the first song is announced once the world is visible, not over the black intro
  let pendingTrack = null;
  sound.onTrack = (t, i) => {
    if (intro.revealed) ui.nowPlaying(t, i, tracksData.tracks.length);
    else pendingTrack = [t, i];
  };
  let phase = 'start';   // start -> starting -> intro -> flight -> ending -> ended
  const resumeMusic = () => sound.resumeMusic(sound.started ? undefined : session.time);
  sound.onMusicState = (state) => {
    if (phase !== 'start') ui.setMusicState(state, resumeMusic);
  };
  addEventListener('visibilitychange', () => { void sound.handleVisibility(document.hidden); });
  if (document.hidden) void sound.handleVisibility(true);
  const intro = new Intro({
    dialogue, soundtrack: sound, ui,
    onReveal: () => {
      ui.veil(true);
      requestAnimationFrame(() => ui.veil(false));
      if (pendingTrack) setTimeout(() => ui.nowPlaying(...pendingTrack, tracksData.tracks.length), 4000);
    },
    onReady: () => ui.showHandover(true, () => intro.skip()),
    onHandover: () => {
      ui.showHandover(false);
      phase = 'flight';
      flight.speedScale = 1;
      ui.enableFlightUi();
    },
  });

  const input = new Input(renderer.domElement);
  input.onZoom = (d) => { if (phase === 'flight') rig.zoom = THREE.MathUtils.clamp(rig.zoom * (d > 0 ? 1.1 : 1 / 1.1), 0.5, 2.4); };
  input.onAction = (a) => {
    if (GLIDER_DEMO && a !== 'fullscreen') { window.app?.demo?.onAction(a); return; }
    if (a === 'skip' && phase === 'intro') intro.skip();
    else if (a === 'camera' && (phase === 'flight' || phase === 'intro')) ui.flashMode(rig.cycle().toUpperCase() + ' VIEW');
    else if (a === 'hide') ui.toggleHidden();
    else if (a === 'mute') { ui.flashMode(sound.toggleMute() ? 'MUTED' : 'SOUND ON'); ui.setVolume(sound.volume, sound.muted); }
    else if (a === 'credits' || (a === 'escape' && !document.getElementById('credits').classList.contains('hidden'))) ui.toggleCredits();
    else if (a === 'help' && phase === 'flight') ui.toggleHelp();
    else if (a === 'fullscreen') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  };

  async function startAudio() {
    // In dev mode flight can precede the first gesture. Join the existing session
    // rather than refilling the tank when delayed audio starts.
    if (DEV && session.time > 0 && Number.isFinite(sound.music.duration)) {
      sound.music.currentTime = Math.min(session.time, sound.music.duration);
    }
    await sound.start();
  }
  async function begin() {
    ui.hideStart();
    phase = 'starting';
    ui.showIntro(true);
    try { await startAudio(); } catch (e) { console.warn('audio', e); }
    ui.setMusicState(sound.musicDiagnostic.state, resumeMusic);
    // Do not advance the fallback clock while media startup is still pending.
    // Both the dialogue and fuel join the audio clock together, or start their
    // shared silent fallback after playback has actually failed.
    phase = 'intro';
    if (PREVIEW_ENDING) {
      const duration = Number.isFinite(sound.music.duration) ? sound.music.duration : session.duration;
      const time = Math.max(0, duration - 8);
      if (sound.started) sound.music.currentTime = time;
      session.time = time;
      session.duration = duration;
      if (!sound.started) void sound.resumeMusic(time);
      rig.intro = 0;
      intro.skip();
      return;
    }
    intro.begin();
  }

  // --- frame -------------------------------------------------------------------------
  let elapsed = 0, last = performance.now();
  const START_CLOCK = Date.UTC(2100, 10, 17, 11, 56);
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  let hudTimer = 0;

  // what the world sounds like around the glider: water against ruins, surf, island birds
  let envTimer = 0, soundEnv = null;
  const camRight = new THREE.Vector3(), toBird = new THREE.Vector3(), toWing = new THREE.Vector3();
  function listen() {
    const { x, z, y } = flight.pos;
    let land = 0, shore = 0;
    const R = 140, N = 10;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2, r = k === N ? 0 : R;
      const h = worldHeight(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (h > 1.2) land++;
      if (h > -1.5 && h < 1.5) shore++;
    }
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const gulls = birds.list.map((b) => {
      toBird.copy(b.pos).sub(camera.position);
      const dist = toBird.length();
      return { dist, pan: toBird.dot(camRight) / Math.max(dist, 1) };
    });
    return {
      land: land / (N + 1), shore: Math.min(1, shore / 4), city: cityMask(x, z),
      low: THREE.MathUtils.clamp(1 - (y - 10) / 120, 0, 1), gulls,
    };
  }

  function frame(now) {
    // Visibility pauses audio separately. Keep the simulation and final glide
    // for the viewer instead of spending them offscreen.
    if (document.hidden) {
      last = now;
      requestAnimationFrame(frame);
      return;
    }
    const cpuStart = performance.now();
    const frameMs = now - last;
    const dt = Math.min(frameMs / 1000, 0.1);
    last = now;
    elapsed += dt;
    renderer.info.reset();
    const resolution = adaptive.sample(frameMs);
    if (resolution !== null) { quality.resolution = resolution; resize(); }

    if (!GLIDER_DEMO && (phase === 'intro' || phase === 'flight')) {
      progress = session.update(dt, { audioTime: sound.time, audioDuration: sound.music.duration, audioStarted: sound.started, audioEnded: sound.music.ended });
    }
    if ((phase === 'flight' || phase === 'intro') && session.ended) {
      if (phase === 'intro') { sound.stopVoice(); ui.showIntro(false); }
      ui.showHandover(false);
      phase = 'ending';
      ending.begin(flight, rig);
      rig.mode = 'chase';
      ui.flashMode('FUEL DEPLETED · FINAL GLIDE');
    }

    // story clock is the music (keeps voices in sync with the mix)
    if (phase === 'intro') intro.update(progress.time);
    const pilotIn = phase === 'flight' ? input.update() : { steer: 0, climb: 0, boost: false };
    Object.assign(flight.input, pilotIn);
    if (phase === 'ending') {
      const result = ending.update(dt, flight, rig);
      ui.setEndingFade(result.fade);
      if (result.fade > 0 && !audioFading) { audioFading = true; sound.finish(6); }
      if (result.finished) {
        phase = 'ended';
        sound.music.pause();
        sound.finish(0.05);
        setTimeout(() => { sound.ctx?.suspend().catch(() => {}); }, 100);
        ui.showEnding(() => {
          if (PREVIEW_ENDING) {
            const url = new URL(location.href);
            url.searchParams.delete('preview');
            location.assign(url.href);
          } else location.reload();
        });
        return; // The opaque end screen needs no FFT, reflection or render loop.
      }
    } else flight.update(dt);
    flight.applyTo(glider);
    const enginePower = phase === 'ending' ? 0 : 1;
    glider.update(dt, flight.throttle, flight, enginePower);
    birds.update(flight, dt);
    if (intro.revealed) rig.intro = Math.max(0, rig.intro - dt / 14);
    rig.update(flight, dt);
    if (trees.userData.update(camera, elapsed)) renderer.shadowMap.needsUpdate = true;
    trails.update(dt, glider, flight, camera);
    envTimer -= dt;
    if (envTimer <= 0 && (intro.revealed || phase === 'flight')) { envTimer = 0.25; soundEnv = listen(); }
    sound.update(flight.throttle, flight.pos.y, soundEnv, enginePower);

    if (phase === 'flight' || phase === 'ending') {
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.25;
        const fuelFrac = progress.fuelFraction;
        const d = new Date(START_CLOCK + progress.time * 1000);
        const hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
        ui.hud({ fuel: 12 * fuelFrac, fuelFrac, alt: flight.pos.y, speed: flight.speed, clock: `${hh}:${mm} · ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} 2100` });
      }
    }

    followShadow();
    casterShadow.update(renderer, scene, [{ pos: flight.pos, radius: glider.radius }, ...birds.bodies], sky.sunDir);
    // small-wave detail (refraction wobble, glitter) is for close views; from flying
    // height it only adds grain
    const low = 1 - THREE.MathUtils.smoothstep(camera.position.y, 12, 90);
    su.uOptics.value.y = THREE.MathUtils.lerp(0.012, 0.06, low);
    su.uGlint.value = 0.6 * low;
    ocean.update(dt);
    caustics.update(sky.sunDir);
    surface.update(camera, elapsed % 3600);
    wingWake.update(dt, glider.wingTips, flight);
    toWing.copy(wingWake.contactPoint).sub(camera.position);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const wingPan = THREE.MathUtils.clamp(toWing.dot(camRight) / Math.max(1, toWing.length()), -1, 1);
    if (GLIDER_DEMO) window.app?.demo?.setWingWaterContact(wingWake.contactStrength, wingPan, flight.speed);
    else sound.setWingWaterContact(wingWake.contactStrength, wingPan, flight.speed);
    spray.update();

    if (renderer.shadowMap.needsUpdate) metrics.shadowUpdates++;
    if (quality.reflections) {
      reflection.render(renderer, scene, camera);
      su.uReflection.value = reflection.target.texture;
    }
    renderer.setRenderTarget(hdrRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    su.uShadowMap.value = sunLight.shadow.map.depthTexture;
    hdrRT.resolveDepthBuffer = false;
    renderer.render(waterScene, camera);
    hdrRT.resolveDepthBuffer = true;
    post.render(hdrRT.texture, dt);
    Object.assign(metrics, { frame: metrics.frame + 1, frameMs, cpuMs: performance.now() - cpuStart, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.app = { flight, rig, sky, post, surface, ocean, sound, ui, scene, camera, glider, birds, applySun, quality, intro, terrain, renderer, session, ending, adaptive, metrics, wingWake, get phase() { return phase; } };

  if (args.has('debug')) (await import('./debug.js')).debugPanel(window.app);
  if (GLIDER_DEMO) {
    ui.hideStart();
    intro.skip();
    ui.toggleHidden();
    const { mountGliderDemo } = await import('./demo/gliderDemo.js');
    window.app.demo = mountGliderDemo(window.app, (next) => {
      glider.root.visible = false;
      glider = next;
      glider.root.visible = true;
      window.app.glider = next;
    });
  } else if (DEV) {
    ui.hideStart();
    intro.skip();
    // no start screen here, so the audio waits for the first click or key (browser autoplay rule)
    const wake = () => { if (phase === 'flight') startAudio().catch((e) => console.warn('audio', e)); removeEventListener('pointerdown', wake); removeEventListener('keydown', wake); };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
  } else {
    ui.ready(begin);
    if (PREVIEW_ENDING) ui.el.begin.querySelector('.begin-label').textContent = 'Preview ending';
  }
}

main().catch((e) => {
  console.error(e);
  ui.setLoading('Something went wrong — see the console.');
});
