import * as THREE from 'three';

// Surface of the drowned buildings, spliced into the shared terrain/prop shader (see
// patch() in scene/terrain.js): plaster and windows laid out in each building's
// own metres so windows line up with its edges, then aged in the shader: broken and
// burnt-out windows, soot and rain streaks, algae under the waterline, ivy, and roofs of
// cracked concrete, peeling plaster, moss and collapsed holes.
const VERT_PARS = /* glsl */`
attribute vec3 aLocal;   // metres in the building frame, y up from its base
attribute vec3 aLocalN;
attribute vec4 aInfo;    // xyz: building origin (seed), w: kind (0 facade, 1 concrete, 2 metal, 3 paint)
varying vec3 vLocalP;
varying vec3 vLocalN;
flat varying vec3 vInstO;
flat varying float vKind;
`;
const VERT_MAIN = /* glsl */`
  vLocalP = aLocal;
  vLocalN = aLocalN;
  vInstO = aInfo.xyz;
  vKind = aInfo.w;
`;
const FRAG_PARS = /* glsl */`
varying vec3 vLocalP;
varying vec3 vLocalN;
flat varying vec3 vInstO;
flat varying float vKind;
// atlases of 3 tiles side by side (tools/prepare_textures.py); *NR = normal x, y, roughness
uniform sampler2D uRoofC, uRoofN;
// one tile of a horizontal atlas, repeating; gradients of the unwrapped uv avoid seams
vec4 atlas(sampler2D t, vec2 uv, float idx) {
  vec2 dx = dFdx(uv) * vec2(1.0 / 3.0, 1.0), dy = dFdy(uv) * vec2(1.0 / 3.0, 1.0);
  return textureGrad(t, vec2((fract(uv.x) + idx) / 3.0, fract(uv.y)), dx, dy);
}
vec3 unpackN(vec2 xy) { vec2 n = xy * 2.0 - 1.0; return vec3(n, sqrt(max(0.0, 1.0 - dot(n, n)))) * 0.5 + 0.5; }
`;

const ALBEDO = /* glsl */`
  float rSeed = th(vInstO.xz * 0.173 + 1.7);
  // each building its own paint and stone: warm limestone, cool concrete, old ochre render
  vec3 rTint = mix(mix(vec3(1.0, 0.95, 0.86), vec3(0.8, 0.84, 0.86), th(vInstO.xz * 0.31)), vec3(0.95, 0.82, 0.66), step(0.78, th(vInstO.xz * 0.71)));
  bool upFace = vLocalN.y > 0.5, downFace = vLocalN.y < -0.5;
  bool rWall = !upFace && !downFace && vKind < 0.5;
  float nC = tn(vWPos.xz * 0.15 + vWPos.y * 0.2);
  vec3 ruinNt = vec3(0.5, 0.5, 1.0);   // tangent-space normal, filled below
  float ruinR = 0.9;
  vec3 albedo;
  // surface metres: along the face and up for vertical faces, plan for horizontal ones
  vec2 fp = abs(vLocalN.x) > 0.5 ? vec2(vLocalP.z * sign(vLocalN.x), vLocalP.y) : vec2(-vLocalP.x * sign(vLocalN.z), vLocalP.y);
  if (upFace || downFace) fp = vLocalP.xz + vInstO.xz;
  if (rWall) {
    // Use plaster rather than a facade photo: the latter contains another window grid.
    vec2 plasterUv = fp / 5.0;
    vec3 wallTexture = atlas(uRoofC, plasterUv, 1.0).rgb;
    vec3 wallNormal = unpackN(atlas(uRoofN, plasterUv, 1.0).rg);
    ruinNt = mix(vec3(0.5, 0.5, 1.0), wallNormal, 0.3);
    float lum = dot(wallTexture, vec3(0.3, 0.59, 0.11));
    vec3 plaster = mix(vec3(0.8, 0.76, 0.68), vec3(0.7, 0.71, 0.69), th(vInstO.xz * 0.91));
    vec3 fc = plaster * rTint * (0.82 + 0.25 * lum) * (0.92 + 0.16 * rSeed);
    vec2 cp = fract(fp / 3.6);
    float ww = 0.56, wh = vLocalP.y < 3.4 ? 0.78 : 0.53;
    float wy = vLocalP.y < 3.4 ? 0.42 : 0.56;
    vec2 aa = fwidth(cp) * 1.5;
    float glass = smoothstep(ww * 0.5 + aa.x, ww * 0.5 - aa.x, abs(cp.x - 0.5)) * smoothstep(wh * 0.5 + aa.y, wh * 0.5 - aa.y, abs(cp.y - wy));
    // far away a window is a few pixels: fade the grid to its average so it doesn't crawl (moire)
    float farW = smoothstep(0.12, 0.35, max(aa.x, aa.y));
    glass = mix(glass, ww * wh * 0.8, farW);
    float sill = step(abs(cp.x - 0.5), ww * 0.5 + 0.03) * step(abs(cp.y - (wy - wh * 0.5) + 0.02), 0.025);
    float lintel = step(abs(cp.x - 0.5), ww * 0.5) * smoothstep(0.08, 0.0, cp.y - (wy + wh * 0.5)) * step(wy + wh * 0.5, cp.y);
    fc = mix(fc, fc * 1.12, sill) * (1.0 - 0.35 * lintel);
    ruinNt = mix(ruinNt, vec3(0.5, 0.5, 1.0), glass);
    // windows: some panes still reflect the sky, most are gone (dark rooms), whole
    // floors burnt out
    vec2 cell = floor(fp / 3.6);
    float paneGone = step(0.35, th(cell + rSeed * 13.0));
    float burnt = 0.0; // Missing panes and damp weathering tell the story of long abandonment.
    // behind a missing pane: the room itself (interior mapping). The wall's tangent frame
    // comes from screen derivatives of the facade metres, so it holds for any building turn.
    vec3 room = vec3(0.045, 0.05, 0.045);
    {
      vec3 dpx = dFdx(vWPos), dpy = dFdy(vWPos);
      vec2 dux = dFdx(fp), duy = dFdy(fp);
      float det = dux.x * duy.y - dux.y * duy.x;
      if (abs(det) > 1e-8) {
        vec3 Tw = normalize((dpx * duy.y - dpy * dux.y) / det), Bw = normalize((dpy * dux.x - dpx * duy.x) / det);
        vec3 V = normalize(vWPos - cameraPosition), Nw = normalize(vWNrm);
        vec3 rd = vec3(dot(V, Tw), dot(V, Bw), max(-dot(V, Nw), 0.05));
        vec2 ro = fract(fp / 3.6);
        float tx = rd.x > 0.0 ? (1.0 - ro.x) / rd.x : -ro.x / min(rd.x, -1e-4);
        float ty = rd.y > 0.0 ? (1.0 - ro.y) / rd.y : -ro.y / min(rd.y, -1e-4);
        float tz = 1.1 / rd.z;                       // rooms a little deeper than tall
        float t = min(min(tx, ty), tz);
        float depth = t * rd.z / 1.1;
        float rs = th(cell + rSeed * 5.0);
        vec3 wall = mix(vec3(0.42, 0.4, 0.36), vec3(0.36, 0.38, 0.37), rs);
        vec3 c = t == tz ? wall * 0.8 : t == ty ? (rd.y < 0.0 ? vec3(0.2, 0.18, 0.15) : wall * 1.1) : wall * 0.65;
        // daylight falls off into the room; floors and back walls stay in gloom
        room = c * mix(0.55, 0.1, depth) * (0.8 + 0.4 * rs);
        if (burnt > 0.5) room *= 0.25;
      }
    }
    albedo = mix(fc, mix(vec3(0.05, 0.06, 0.065), room, max(paneGone, burnt)), glass);   // intact panes: dark glass, reflecting the sky
    albedo = mix(albedo, albedo * 0.4, burnt * 0.7 * smoothstep(0.2, 0.9, cp.y));     // soot licking up from burnt windows
    ruinR = mix(0.92, mix(0.06, 0.95, max(paneGone, burnt)), glass);
    // rain streaks below the sills, soot, and grime gathering towards the ground
    float streak = tn(vec2(fp.x * 1.7, fp.y * 0.04)) * tn(vec2(fp.x * 0.6, fp.y * 0.1 + 3.0));
    albedo *= 1.0 - 0.45 * smoothstep(0.25, 0.6, streak);
    albedo *= mix(1.0, 0.62, smoothstep(0.5, 0.85, tn(fp * 0.05 + rSeed * 20.0)));
    // Subtle damp moss stays beneath the modeled vegetation rather than imitating leaves.
    vec3 moss = atlas(uRoofC, fp / 3.0, 2.0).rgb;
    float damp = smoothstep(5.0, 0.0, vWPos.y) * step(0.0, vWPos.y);
    float mossMask = damp * smoothstep(0.56, 0.77, tn(fp * 0.35 + rSeed * 7.0)) * 0.45;
    albedo = mix(albedo, moss * vec3(0.55, 0.65, 0.46), mossMask);
    ruinR = mix(ruinR, 0.95, mossMask);
  } else if (vKind > 3.5) {
    // lime-washed masonry with a red band (the lighthouse): flaking, salt-stained
    vec3 conc = atlas(uRoofC, fp / 4.0, 1.0).rgb;
    ruinNt = unpackN(atlas(uRoofN, fp / 4.0, 1.0).rg);
    float band = step(0.5, fract(vLocalP.y / 14.4 + 0.1)) * step(14.0, vLocalP.y);
    vec3 wash = mix(vec3(0.93, 0.91, 0.86), vec3(0.62, 0.13, 0.09), band);
    float flake = smoothstep(0.58, 0.72, tn(fp * 0.5 + 3.0));
    albedo = mix(wash * (0.9 + 0.1 * dot(conc, vec3(0.33))), conc * 0.75, flake);
    albedo *= 1.0 - 0.3 * smoothstep(0.4, 0.8, tn(vec2(fp.x * 1.5, fp.y * 0.06)));   // run-off
    ruinR = 0.85;
  } else if (vKind > 2.5) {
    // painted steel: shipping containers (corrugated sides), gondolas; sun-faded paint,
    // rust bleeding from the seams and the bottom rail
    float pick = th(vInstO.xz * 0.37 + vInstO.y * 1.3);
    vec3 paint = pick < 0.2 ? vec3(0.52, 0.12, 0.07) : pick < 0.38 ? vec3(0.1, 0.26, 0.42) : pick < 0.52 ? vec3(0.16, 0.36, 0.24)
               : pick < 0.66 ? vec3(0.78, 0.38, 0.1) : pick < 0.8 ? vec3(0.62, 0.6, 0.55) : pick < 0.9 ? vec3(0.82, 0.8, 0.74) : vec3(0.7, 0.55, 0.16);
    paint = mix(paint, vec3(dot(paint, vec3(0.33))) * vec3(1.05, 1.0, 0.92), 0.35) * (0.85 + 0.3 * th(vInstO.zx));   // faded
    float along = abs(vLocalN.x) > 0.5 ? vLocalP.z : vLocalP.x;
    float rib = upFace || downFace ? 0.0 : sin(along * 20.0);
    ruinNt = normalize(vec3(rib * 0.45, 0.0, 1.0)) * 0.5 + 0.5;
    float rust = smoothstep(0.55, 0.8, tn(fp * vec2(1.2, 0.3) + rSeed * 7.0)) + smoothstep(0.5, 0.0, fract(vLocalP.y / 2.6)) * 0.5 * tn(fp * 3.0);
    albedo = mix(paint, mix(vec3(0.25, 0.11, 0.05), vec3(0.45, 0.23, 0.1), tn(fp * 4.0)), clamp(rust, 0.0, 1.0));
    albedo *= 0.92 + 0.16 * rib;
    ruinR = mix(0.55, 0.85, clamp(rust, 0.0, 1.0));
  } else if (!upFace && vKind > 1.5) {
    // rusted steel: tanks, legs, rebar, AC boxes; flakes of old paint
    float n1 = tn(fp * 2.3 + rSeed * 9.0), n2 = tn(fp * 0.7 + 3.0);
    // weathered dark steel, rust blooming through in patches and running down
    float rustM = smoothstep(0.35, 0.7, n1 * 0.7 + tn(vec2(fp.x * 0.8, fp.y * 0.15) + 4.0) * 0.5);
    albedo = mix(vec3(0.2, 0.2, 0.19) * (0.8 + 0.4 * n2), mix(vec3(0.22, 0.1, 0.05), vec3(0.42, 0.22, 0.1), n1), rustM);
    albedo = mix(albedo, vec3(0.62, 0.66, 0.6) * rTint, smoothstep(0.6, 0.66, n2) * 0.6);
    albedo *= 0.75 + 0.5 * atlas(uRoofC, fp / 2.0, 0.0).r;
    ruinNt = unpackN(atlas(uRoofN, fp / 2.0, 0.0).rg);
    ruinR = mix(0.55, 0.85, n1);
  } else if (!upFace) {
    // structural concrete: columns, slab edges and undersides, parapets, ledges, rubble
    vec3 conc = atlas(uRoofC, fp / 4.0, 0.0).rgb;
    ruinNt = unpackN(atlas(uRoofN, fp / 4.0, 0.0).rg);
    albedo = conc * 0.72 * rTint;
    float stain = tn(vec2(fp.x * 1.3, fp.y * 0.08) + rSeed * 5.0);
    albedo *= 1.0 - 0.4 * smoothstep(0.45, 0.75, stain);                       // run-off
    albedo *= mix(1.0, 0.72, smoothstep(0.6, 0.8, tn(fp * 0.6 + 11.0)));       // spalling
    if (downFace) albedo *= 0.55;                                                // soffits stay dark
    // moss keeps to the damp lower storeys
    float mossE = smoothstep(0.62, 0.78, tn(fp * 0.4 + 2.0)) * step(0.0, vWPos.y) * smoothstep(28.0, 6.0, vWPos.y);
    albedo = mix(albedo, atlas(uRoofC, fp / 3.0, 2.0).rgb * 0.7, mossE);
    ruinR = 0.92;
  } else {
    vec3 conc = atlas(uRoofC, fp / 6.0, 0.0).rgb * 0.62;
    vec3 plaster = atlas(uRoofC, fp / 5.0, 1.0).rgb;
    float pl = dot(plaster, vec3(0.3, 0.59, 0.11));
    plaster = mix(plaster, vec3(pl), 0.5) * 0.6;
    float peel = smoothstep(0.5, 0.62, tn(fp * 0.08 + rSeed * 9.0));
    albedo = mix(conc, plaster, peel) * mix(vec3(1.0), rTint, 0.7);
    ruinNt = unpackN(mix(atlas(uRoofN, fp / 6.0, 0.0).rg, atlas(uRoofN, fp / 5.0, 1.0).rg, peel));
    albedo *= mix(1.0, 0.68, smoothstep(0.45, 0.75, tn(fp * 0.3)));   // puddle stains
    float tuft = smoothstep(0.58, 0.78, tn(fp * 0.5) * 0.6 + tn(fp * 0.13) * 0.4) * step(0.0, vWPos.y);
    albedo = mix(albedo, atlas(uRoofC, fp / 4.0, 2.0).rgb * 0.7, tuft);
    if (vKind > 1.5) albedo = mix(vec3(0.19, 0.19, 0.18), mix(vec3(0.24, 0.11, 0.05), vec3(0.42, 0.22, 0.1), tn(fp * 2.0)), smoothstep(0.4, 0.7, tn(fp * 0.35 + 6.0))) * (1.0 - tuft * 0.5);
    // gutted roofs: dark holes into the floors below
    float hole = smoothstep(0.6, 0.65, tn(fp * 0.11 + 31.0)) * step(rSeed, 0.55) * step(vKind, 0.5);
    albedo = mix(albedo, vec3(0.02, 0.025, 0.022), hole);
    ruinR = 0.9;
  }
  // under the waterline: algae and silt; a dark wet band at the surface
  float nS = tn(fp * 0.4);
  float algae = smoothstep(0.6, -1.5, vWPos.y + nS * 1.5);
  // algae and silt over what is there, so the texture still reads through
  vec3 algaeC = mix(vec3(0.11, 0.17, 0.09), vec3(0.3, 0.32, 0.18), nC) * (0.75 + 0.5 * tn(fp * 1.3 + 2.0));
  albedo = mix(albedo, mix(albedo * vec3(0.7, 0.85, 0.65), algaeC, 0.55 + 0.35 * nS), algae * 0.9);
  albedo *= mix(1.0, 0.7, smoothstep(0.9, 0.1, vWPos.y) * smoothstep(-0.6, 0.2, vWPos.y));
  diffuseColor.rgb = albedo;
`;
const ROUGH = /* glsl */`
  roughnessFactor = ruinR;
`;

// tangent frame from the world normal: u runs horizontally along the wall, v up
const NORMAL = /* glsl */`
  {
    vec3 N = normalize(vWNrm);
    vec3 T = abs(N.y) < 0.9 ? normalize(cross(vec3(0.0, 1.0, 0.0), N)) : vec3(1.0, 0.0, 0.0);
    vec3 B = cross(N, T);
    vec3 tn3 = ruinNt * 2.0 - 1.0;
    tn3.xy *= 0.9;
    vec3 nW = normalize(T * tn3.x + B * tn3.y + N * tn3.z);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }
`;

const loader = new THREE.TextureLoader();
function tex(file, srgb, anisotropy = 8) {
  const t = loader.load(`/textures/${file}`);
  t.wrapS = THREE.ClampToEdgeWrapping;   // atlases: the shader wraps inside each tile
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

export function ruinSurface() {
  const uniforms = {
    uRoofC: { value: tex('ruin_roof_color.jpg', true) },
    uRoofN: { value: tex('ruin_roof_n.png', false) },
  };
  return {
    uniforms,
    ext: { key: '-ruin-v2', vertPars: VERT_PARS, vertMain: VERT_MAIN, fragPars: FRAG_PARS, albedo: ALBEDO, rough: ROUGH, normal: NORMAL },
  };
}
