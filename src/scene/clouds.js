// Shadows of the fair-weather clouds drifting over land and water. The cloud layer sits
// ~650 m up; a point's shadow is found by stepping along the sun direction to that layer.
// Needs uTime declared before it (both the terrain and the water shaders have it).
export const CLOUD_SHADOW_GLSL = /* glsl */`
float csHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float csNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(csHash(i), csHash(i + vec2(1, 0)), u.x), mix(csHash(i + vec2(0, 1)), csHash(i + 1.0), u.x), u.y); }
float cloudShadow(vec3 p, vec3 sunDir) {
  vec2 q = p.xz + sunDir.xz / max(sunDir.y, 0.25) * (650.0 - p.y);
  q += vec2(7.0, 3.0) * uTime;                        // the wind carries them slowly
  float n = csNoise(q * 0.0011) * 0.55 + csNoise(q * 0.0029 + 17.0) * 0.3 + csNoise(q * 0.008 + 41.0) * 0.15;
  return mix(1.0, 0.5, smoothstep(0.56, 0.7, n));
}
`;
