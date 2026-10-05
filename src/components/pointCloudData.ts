export const CYCLE_SECONDS = 16.2;

export type CloudPoint = {
  x: number;
  y: number;
  z: number;
  half: 0 | 1;
  // Face bits: -X, +X, -Y, +Y, -Z, +Z. Edges belong to two faces.
  faces: number;
  edge: boolean;
  boundary: boolean;
};

function generateCubeSurfacePoints(): CloudPoint[] {
  const divisions = 15;
  const points: CloudPoint[] = [];
  for (let x = 0; x <= divisions; x += 1) {
    for (let y = 0; y <= divisions; y += 1) {
      for (let z = 0; z <= divisions; z += 1) {
        const boundaries = [
          x === 0,
          x === divisions,
          y === 0,
          y === divisions,
          z === 0,
          z === divisions,
        ];
        const faces = boundaries.reduce(
          (mask, onFace, index) => mask | (onFace ? 1 << index : 0),
          0,
        );
        if (!faces) continue;
        const px = (x / divisions) * 2 - 1;
        const py = (y / divisions) * 2 - 1;
        const pz = (z / divisions) * 2 - 1;
        const nearSeam = (index: number) => Math.abs(index - divisions / 2) === 0.5;
        const boundary =
          (nearSeam(x) && (py < 0) !== (pz < 0)) ||
          (nearSeam(y) && (px < 0) !== (pz < 0)) ||
          (nearSeam(z) && (px < 0) !== (py < 0));
        points.push({
          x: px,
          y: py,
          z: pz,
          // Coordinate majority retains the two complementary three-arm regions.
          // The odd lattice avoids ambiguous samples on their shared zero planes.
          half: Number(px < 0) + Number(py < 0) + Number(pz < 0) >= 2 ? 0 : 1,
          faces,
          edge: boundaries.filter(Boolean).length >= 2,
          boundary,
        });
      }
    }
  }
  return points;
}

export const CLOUD_POINTS: readonly CloudPoint[] = generateCubeSurfacePoints();
