import { fbm } from '../scene/noise.js';

// The drowned world: a shallow turquoise shelf cut by deep blue channels, a few green
// islands and the grid of sunken cities. Terrain mesh, shore map and ruins all read
// worldHeight(). Past WORLD_RADIUS everything falls away into open ocean.
export const WORLD_SIZE = 11200;
export const WORLD_RADIUS = 4900;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

// Sunken city districts: centre, radius. The flight starts over the first one.
export const CITIES = [
  { x: 0, z: 0, r: 520 },
  { x: 1450, z: -900, r: 430 },
  { x: -1300, z: -1200, r: 380 },
  { x: -900, z: 1400, r: 470 },
  { x: 1500, z: 1300, r: 360 },
  { x: 3300, z: -300, r: 560 },
  { x: -3300, z: 300, r: 500 },
  { x: 300, z: -3400, r: 520 },
  { x: 200, z: 3500, r: 480 },
  { x: -2800, z: -3000, r: 420 },
  { x: 2900, z: 3000, r: 400 },
];

// Landmarks (built in landmarks.js): position, heading. The autopilot visits them too.
export const LANDMARKS = [
  { type: 'bridge', x: 2380, z: -620, yaw: 1.2 },
  { type: 'ship', x: -2150, z: 750, yaw: 0.7 },
  { type: 'lighthouse', x: -1900, z: 2900, yaw: 0 },
  { type: 'wheel', x: 950, z: 1950, yaw: 0.4 },
  { type: 'tower', x: -600, z: -2500, yaw: 0.2 },
  { type: 'stadium', x: 2250, z: 1900, yaw: 0.3 },
];

// 0..1, 1 in the middle of a district (edges ragged by noise)
export function cityMask(x, z) {
  let m = 0;
  const n = 0.25 * fbm(x * 0.004 + 40, z * 0.004 - 12, 3, 77);
  for (const c of CITIES) {
    const d = Math.hypot(x - c.x, z - c.z) / c.r + n;
    m = Math.max(m, 1 - smooth(0.55, 1.0, d));
  }
  return m;
}

export function worldHeight(x, z) {
  // domain warp so channels meander instead of following the noise lattice
  const wx = x + 260 * fbm(x * 0.0007 + 3.1, z * 0.0007 - 7.4, 3, 5);
  const wz = z + 260 * fbm(x * 0.0007 - 9.2, z * 0.0007 + 1.7, 3, 6);

  // shallow shelf, 3..9 m deep, with soft dunes
  let h = -5.8 + 2.6 * fbm(wx * 0.0021, wz * 0.0021, 4, 11) + 0.8 * fbm(x * 0.012, z * 0.012, 3, 12);

  // long deep channels (the dark blue streaks seen from above)
  const ch = 1 - Math.abs(fbm(wx * 0.0009, wz * 0.0009, 4, 21));
  const deep = Math.max(smooth(0.86, 0.97, ch), 0.6 * smooth(0.9, 0.98, 1 - Math.abs(fbm(wx * 0.0021, wz * 0.0021, 3, 23))));
  // open basins
  const basin = smooth(-0.18, -0.42, fbm(wx * 0.0004 + 8, wz * 0.0004, 3, 31));
  h = mix(h, -30 + 6 * fbm(x * 0.006, z * 0.006, 2, 3), Math.max(deep, basin));

  // drowned districts: a flattened plain at street level
  const city = cityMask(x, z);
  h = mix(h, -7.5 + 1.2 * fbm(x * 0.01, z * 0.01, 2, 41), city * 0.9);

  // islands: a few green humps with beaches, away from the cities
  const isl = fbm(wx * 0.0011 + 17, wz * 0.0011 - 5, 4, 51) - 0.3;
  if (isl > 0) {
    const t = smooth(0, 0.22, isl) * (1 - city);
    const hill = 6 + 34 * smooth(0.08, 0.35, isl) * (0.7 + 0.3 * fbm(x * 0.008, z * 0.008, 3, 52));
    h = mix(h, hill, t);
  }
  // pale sandbars just under the surface: bright turquoise shallows, not hard strips of sand
  const bar = 1 - Math.abs(fbm(wx * 0.0018 + 5, wz * 0.0018 + 9, 3, 61));
  h = Math.max(h, mix(-11, -0.9, smooth(0.965, 0.995, bar) * smooth(0.1, 0.4, fbm(x * 0.001, z * 0.001, 2, 62) + 0.3)) * (1 - city) - 9 * city);

  // Soften the waterline without flattening small islands into broad sand plates.
  // The multiplier reaches one at 4 m, keeping the profile continuous there.
  if (h > 0 && h < 4) h *= mix(0.72, 1, smooth(0, 4, h));

  // landmark ground: the lighthouse's rock, the stadium's flooded pitch
  for (const l of LANDMARKS) {
    const d = Math.hypot(x - l.x, z - l.z);
    if (l.type === 'lighthouse' && d < 110) h = Math.max(h, mix(-6, 9 + 3 * fbm(x * 0.05, z * 0.05, 3, 71), smooth(105, 30, d + 14 * fbm(x * 0.03, z * 0.03, 2, 72))));
    if (l.type === 'stadium' && d < 170) h = mix(h, -9.5 + 0.4 * fbm(x * 0.02, z * 0.02, 2, 73), smooth(170, 110, d));
  }

  // world edge: fall into the open ocean
  const r = Math.hypot(x, z);
  h = mix(h, -48, smooth(WORLD_RADIUS - 400, WORLD_RADIUS + 200, r));
  return h;
}
