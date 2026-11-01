import * as THREE from 'three';

// The trunk is scaled much narrower than it is tall by vegetation.js. Branch
// reach is therefore expressed in trunk-width units, not crown-radius units.
export function trunkGeometry() {
  const positions = [], uvs = [], indices = [];
  function limb(points, radii, sides) {
    const base = positions.length / 3;
    for (let j = 0; j < points.length; j++) {
      const tangent = points[Math.min(j + 1, points.length - 1)].clone()
        .sub(points[Math.max(j - 1, 0)]).normalize();
      const reference = Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const a = new THREE.Vector3().crossVectors(tangent, reference).normalize();
      const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
      for (let k = 0; k <= sides; k++) {
        const angle = k / sides * Math.PI * 2;
        const p = points[j].clone().addScaledVector(a, Math.cos(angle) * radii[j]).addScaledVector(b, Math.sin(angle) * radii[j]);
        positions.push(p.x, p.y, p.z);
        uvs.push(k / sides, j / (points.length - 1));
      }
      if (j) for (let k = 0; k < sides; k++) {
        const x = base + (j - 1) * (sides + 1) + k, y = x + sides + 1;
        indices.push(x, x + 1, y, x + 1, y + 1, y);
      }
    }
  }
  limb([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.05, 0.32, 0.02),
    new THREE.Vector3(-0.05, 0.65, 0.05), new THREE.Vector3(0.12, 1.03, 0.04),
  ], [0.62, 0.43, 0.31, 0.12], 7);
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.39996, dx = Math.cos(angle), dz = Math.sin(angle);
    const start = 0.53 + (i % 3) * 0.075;
    const reach = 2.4 + (i % 2) * 0.6;
    limb([
      new THREE.Vector3(-0.03, start, 0.04),
      new THREE.Vector3(dx * reach * 0.48, start + 0.14, dz * reach * 0.48),
      new THREE.Vector3(dx * reach, start + 0.28, dz * reach),
    ], [0.24, 0.14, 0.045], 6);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Fold each textured cluster along its centre. Different heights, tilts and
// offsets break up the crown while the shared mesh remains cheap to instance.
export function crownGeometry(rand) {
  const positions = [], normals = [], uvs = [], indices = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 28; i++) {
    const angle = i * 2.39996 + (rand() - 0.5) * 0.5;
    const radius = 0.18 + Math.sqrt(rand()) * 0.57;
    const centre = new THREE.Vector3(Math.cos(angle) * radius, 0.15 + (1 - radius) * 0.22 + (rand() - 0.5) * 0.28, Math.sin(angle) * radius);
    const facing = new THREE.Vector3(centre.x * 0.7, 0.55 + rand() * 0.65, centre.z * 0.7).normalize();
    const spin = rand() * Math.PI * 2;
    const right = new THREE.Vector3(Math.cos(spin), 0, Math.sin(spin));
    right.addScaledVector(facing, -right.dot(facing)).normalize();
    const along = new THREE.Vector3().crossVectors(facing, right).normalize();
    const width = 0.23 + rand() * 0.13, height = 0.25 + rand() * 0.14;
    const fold = 0.05 + rand() * 0.06, flip = rand() < 0.5;
    const base = positions.length / 3;
    for (const y of [-1, 1]) for (const x of [-1, 0, 1]) {
      const p = centre.clone().addScaledVector(right, x * width).addScaledVector(along, y * height)
        .addScaledVector(facing, x === 0 ? fold : 0);
      const n = p.clone().addScaledVector(up, 0.5).normalize();
      positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z);
      const u = flip ? (1 - x) / 2 : (x + 1) / 2;
      uvs.push(0.5 + u * 0.5, 0.5 + (y + 1) * 0.25);
    }
    indices.push(base, base + 1, base + 4, base, base + 4, base + 3,
      base + 1, base + 2, base + 5, base + 1, base + 5, base + 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
