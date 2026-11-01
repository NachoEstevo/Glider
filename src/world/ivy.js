import * as THREE from 'three';

// Each patch is built in metres, then rotated into its building's frame.  No
// non-uniform instance scale is applied to the leaves or stems.
function leafTexture() {
  // Fine mottling and a midrib with angled secondary veins, in leaf UV space.
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1) - 0.5, v = y / (size - 1);
    const noise = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = (noise - Math.floor(noise) - 0.5) * 13;
    const rib = Math.exp(-Math.abs(u) * 85) * 24;
    const veinPhase = Math.abs(((v + Math.abs(u) * 0.65) * 10) % 1 - 0.5);
    const veins = Math.exp(-veinPhase * 38) * Math.min(1, Math.abs(u) * 12) * 11;
    const light = grain + rib + veins + 5 * Math.sin(v * 18 + u * 12);
    const i = (y * size + x) * 4;
    data[i] = 53 + light; data[i + 1] = 91 + light; data[i + 2] = 35 + light * 0.7; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

// A single folded leaf is shared by every spatial batch. Instance transforms
// carry its world-space shape and tint without duplicating its vertices.
function leafGeometry() {
  const outline = [[0, 0], [-0.42, 0.18], [-0.5, 0.48], [-0.26, 0.48], [0, 1], [0.26, 0.48], [0.5, 0.48], [0.42, 0.18]];
  const positions = [0, 0.43, 0.12], colors = [1.17, 1.17, 1.17], uvs = [0.5, 0.43], indices = [];
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i], shade = 0.88 + ((i + 1) % 3) * 0.06;
    positions.push(x, y, 0); colors.push(shade, shade, shade); uvs.push(x + 0.5, y);
    indices.push(0, i + 1, (i + 1) % outline.length + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function stemGeometry() {
  const positions = [], indices = [];
  for (const z of [0, 1]) for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) positions.push(x, y, z);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; indices.push(i, j, 4 + j, i, 4 + j, 4 + i); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createIvy(patches, patchCustom, rand) {
  const cells = new Map();
  const cellSize = 128;
  for (const patch of patches) {
    const key = `${Math.floor(patch.p.x / cellSize)},${Math.floor(patch.p.z / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(patch);
  }
  const group = new THREE.Group();
  const leafMaterial = new THREE.MeshStandardMaterial({ map: leafTexture(), vertexColors: true, side: THREE.DoubleSide, roughness: 0.87 });
  const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4b5430, roughness: 1 });
  patchCustom(leafMaterial, {}, { key: '-ivy-leaves' });
  patchCustom(stemMaterial, {}, { key: '-ivy-stems' });
  leafMaterial.shadowSide = THREE.DoubleSide;
  const batches = [];
  const sharedLeafGeometry = leafGeometry(), sharedStemGeometry = stemGeometry();
  for (const patchesInCell of cells.values()) {
    const leavesBase = [], leavesDetail = [], stemMatrices = [];
    const emitLeaf = (center, direction, size, color, transform, detail = false) => {
      const side = new THREE.Vector3(-direction.y, direction.x, 0).normalize().applyAxisAngle(direction, (rand() - 0.5) * 1.7);
      const normal = new THREE.Vector3().crossVectors(side, direction).normalize();
      const matrix = new THREE.Matrix4().makeBasis(side, direction, normal).scale(new THREE.Vector3(size, size, size));
      const placement = new THREE.Matrix4().compose(transform.p, transform.q, new THREE.Vector3(1, 1, 1));
      matrix.setPosition(center);
      matrix.premultiply(placement);
      (detail ? leavesDetail : leavesBase).push({ matrix, color });
    };
    const emitStem = (a, b, radius, transform) => {
      const delta = b.clone().sub(a), axis = delta.clone().normalize();
      const reference = Math.abs(axis.z) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      const u = reference.cross(axis).normalize().multiplyScalar(radius);
      const v = axis.clone().cross(u).normalize().multiplyScalar(radius);
      const matrix = new THREE.Matrix4().makeBasis(u, v, delta).setPosition(a);
      const placement = new THREE.Matrix4().compose(transform.p, transform.q, new THREE.Vector3(1, 1, 1));
      stemMatrices.push(matrix.premultiply(placement));
    };
    for (const patch of patchesInCell) {
      const n = Math.max(1, Math.min(10, Math.ceil(patch.w / 1.2)));
      for (let k = 0; k < n; k++) {
        const x = (k / n - 0.5 + rand() / n) * patch.w;
        // Shorter wandering vines fill the top while a few longer stems trail down.
        const length = Math.min(patch.h, rand() < 0.55 ? 1.4 + rand() * 3.4 : 4 + rand() * 5.5);
        const segments = Math.max(3, Math.ceil(length / 0.55));
        const drift = (rand() - 0.5) * 1.1, phase = rand() * 6.28;
        // The first section crosses the roof edge above the roof surface.
        let prev = new THREE.Vector3(x, 0.16, -0.55);
        for (let j = 0; j <= segments; j++) {
          const t = j / segments;
          const point = new THREE.Vector3(x + drift * t + Math.sin(t * 5 + phase) * 0.12 * t, j === 0 ? 0.16 : -length * t + (rand() - 0.5) * 0.22, j === 0 ? 0.12 : 0.16 + 0.13 * Math.sin(Math.PI * t));
          emitStem(prev, point, 0.025 * (1 - t * 0.65), patch);
          {
            // Paired shoots form an irregular three-dimensional cluster at each node.
            // The second shoot is near-detail, while the first remains visible at range.
            for (let shoot = 0; shoot < 2; shoot++) {
              const sign = (j + shoot) % 2 ? 1 : -1;
              const branch = point.clone().add(new THREE.Vector3(sign * (0.35 + rand() * 0.4), -0.03 - rand() * 0.26, 0.09 + rand() * 0.2));
              emitStem(point, branch, 0.009, patch);
              for (let l = 0; l < 3; l++) {
                const origin = point.clone().lerp(branch, 0.18 + l * 0.34).add(new THREE.Vector3((rand() - 0.5) * 0.14, (rand() - 0.5) * 0.18, rand() * 0.12));
                const angle = sign * (0.4 + rand() * 1.25) + (rand() - 0.5) * 0.55;
                const dir = new THREE.Vector3(Math.sin(angle), -Math.cos(angle), (rand() - 0.25) * 1.1).normalize();
                const color = [0.75 + rand() * 0.25, 0.78 + rand() * 0.22, 0.68 + rand() * 0.28];
                emitLeaf(origin, dir, 0.24 + rand() * 0.14, color, patch, shoot === 1);
              }
            }
          }
          prev = point;
        }
      }
    }
    const makeLeaves = (instances) => {
      const mesh = new THREE.InstancedMesh(sharedLeafGeometry, leafMaterial, instances.length);
      instances.forEach(({ matrix, color }, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, new THREE.Color(...color));
      });
      mesh.computeBoundingSphere();
      return mesh;
    };
    const leaves = makeLeaves(leavesBase);
    const detail = makeLeaves(leavesDetail);
    const stems = new THREE.InstancedMesh(sharedStemGeometry, stemMaterial, stemMatrices.length);
    stemMatrices.forEach((matrix, i) => stems.setMatrixAt(i, matrix));
    stems.computeBoundingSphere();
    leaves.castShadow = leaves.receiveShadow = detail.castShadow = detail.receiveShadow = stems.castShadow = stems.receiveShadow = true;
    group.add(leaves, stems, detail);
    batches.push({ leaves, stems, detail, sphere: leaves.boundingSphere.clone().union(detail.boundingSphere) });
  }
  // Spatial batches retain normal frustum culling. Hide fine stems/leaves only at
  // long range, with bounding radius included so large cells do not disappear early.
  group.userData.update = (camera) => {
    let changed = false;
    for (const batch of batches) {
      const distance = camera.position.distanceTo(batch.sphere.center) - batch.sphere.radius;
      const leavesVisible = distance < 450, stemsVisible = distance < 180, detailVisible = distance < 160;
      changed ||= batch.leaves.visible !== leavesVisible || batch.stems.visible !== stemsVisible || batch.detail.visible !== detailVisible;
      batch.leaves.visible = leavesVisible;
      batch.stems.visible = stemsVisible;
      batch.detail.visible = detailVisible;
    }
    return changed;
  };
  return group;
}
