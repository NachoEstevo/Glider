import GUI from 'lil-gui';

// ?debug: tuning panel for the look (sun, water, waves, post, camera).
export function debugPanel(app) {
  const gui = new GUI({ title: 'Glider' });
  const sun = gui.addFolder('Sun & sky');
  for (const [k, lo, hi] of [['elevation', -2, 89], ['azimuth', 0, 360], ['cloudCoverage', 0, 1], ['turbidity', 1, 10], ['sunIntensity', 0, 20]])
    sun.add(app.sky.params, k, lo, hi, 0.01).onChange(app.applySun);

  const su = app.surface.uniforms;
  const water = gui.addFolder('Water');
  const w = { clarity: 1, glint: su.uGlint.value };
  const abs = su.uAbsorption.value.clone();
  water.add(w, 'clarity', 0.3, 3, 0.01).onChange((v) => su.uAbsorption.value.copy(abs).multiplyScalar(1 / v));
  water.add(su.uGlint, 'value', 0, 1, 0.01).name('glitter');
  const op = app.ocean.params;
  water.add(op, 'windSpeed', 1, 25, 0.1).onChange(() => (app.ocean.dirty = true));
  water.add(op, 'choppiness', 0, 2, 0.01);

  const post = gui.addFolder('Post');
  for (const [k, lo, hi] of [['exposure', 0.25, 4], ['keyValue', 0.05, 0.6], ['bloomStrength', 0, 0.5], ['contrast', 0.7, 1.6], ['saturation', 0, 2]])
    post.add(app.post.params, k, lo, hi, 0.01);

  const cam = gui.addFolder('Camera');
  cam.add(app.rig, 'mode', ['overhead', 'chase', 'orbit']);
  cam.add(app.rig, 'zoom', 0.5, 2.4, 0.01);
  cam.add(app.flight, 'autopilot');
  gui.close();
  return gui;
}
