import {
  NX, NY, NZ, RX, RY, RZ, stiffnessByType,
} from '../config.js';

/**
 * La estructura estática de la sandía: partículas, resortes, celdas y caras.
 *
 * Nada de acá cambia durante la simulación salvo `sprAlive` (que el corte apaga)
 * y las posiciones. Todo lo demás se construye una vez y se consulta.
 */

// [di, dj, dk, tipo]  tipo: 0 estructural, 1 shear, 2 bend
const SPRING_OFFSETS = [
  [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0],
  [1, 1, 0, 1], [1, -1, 0, 1], [1, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, 1], [0, 1, -1, 1],
  [2, 0, 0, 2], [0, 2, 0, 2], [0, 0, 2, 2],
];

// orden de esquinas antihorario visto desde afuera, por dirección (+X,-X,+Y,-Y,+Z,-Z)
const FACE_CORNERS = [
  [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],
  [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],
  [[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
  [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
];
const FACE_NB = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

/* Mapeo cubo→esfera: convierte la lattice completa en un elipsoide sólido y
   liso, sin escalera de vóxeles ni partículas recortadas. */
function cubeToSphere(u, v, w, out) {
  const u2 = u * u, v2 = v * v, w2 = w * w;
  out[0] = u * Math.sqrt(Math.max(0, 1 - v2 * 0.5 - w2 * 0.5 + v2 * w2 / 3));
  out[1] = v * Math.sqrt(Math.max(0, 1 - u2 * 0.5 - w2 * 0.5 + u2 * w2 / 3));
  out[2] = w * Math.sqrt(Math.max(0, 1 - u2 * 0.5 - v2 * 0.5 + u2 * v2 / 3));
}

export function createLattice() {
  const N = NX * NY * NZ;
  const gid = (i, j, k) => (i * NY + j) * NZ + k;

  const pos  = new Float32Array(N * 3);
  const prev = new Float32Array(N * 3);
  const rest = new Float32Array(N * 3);

  // --- posiciones de reposo ---
  {
    const s = [0, 0, 0];
    for (let i = 0; i < NX; i++) {
      const u = -1 + 2 * i / (NX - 1);
      for (let j = 0; j < NY; j++) {
        const v = -1 + 2 * j / (NY - 1);
        for (let k = 0; k < NZ; k++) {
          const w = -1 + 2 * k / (NZ - 1);
          cubeToSphere(u, v, w, s);
          const o = gid(i, j, k) * 3;
          rest[o]     = s[0] * RX;
          rest[o + 1] = s[1] * RY;
          rest[o + 2] = s[2] * RZ;
        }
      }
    }
  }

  // --- resortes: estructurales / shear / bend ---
  const structSpring = new Int32Array(N * 3).fill(-1); // (gid, eje) -> id de resorte
  let sprA, sprB, sprRest, sprK, sprType, sprAlive, M = 0, maxSprLen = 0;
  {
    const K = stiffnessByType();
    const a = [], b = [], r = [], kk = [], tt = [];
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
      const ga = gid(i, j, k);
      for (let s = 0; s < SPRING_OFFSETS.length; s++) {
        const [di, dj, dk, t] = SPRING_OFFSETS[s];
        const i2 = i + di, j2 = j + dj, k2 = k + dk;
        if (i2 < 0 || i2 >= NX || j2 < 0 || j2 >= NY || k2 < 0 || k2 >= NZ) continue;
        const gb = gid(i2, j2, k2);
        const dx = rest[gb * 3] - rest[ga * 3];
        const dy = rest[gb * 3 + 1] - rest[ga * 3 + 1];
        const dz = rest[gb * 3 + 2] - rest[ga * 3 + 2];
        const L = Math.hypot(dx, dy, dz);
        const id = a.length;
        a.push(ga); b.push(gb); r.push(L); kk.push(K[t]); tt.push(t);
        if (L > maxSprLen) maxSprLen = L;
        if (t === 0) {
          const axis = di === 1 ? 0 : (dj === 1 ? 1 : 2);
          structSpring[ga * 3 + axis] = id;
        }
      }
    }
    M = a.length;
    sprA = Int32Array.from(a); sprB = Int32Array.from(b);
    sprRest = Float32Array.from(r); sprK = Float32Array.from(kk);
    sprType = Uint8Array.from(tt);
    sprAlive = new Uint8Array(M).fill(1);
  }

  // --- celdas: 8 esquinas y las 12 aristas estructurales que las unen ---
  const NCX = NX - 1, NCY = NY - 1, NCZ = NZ - 1;
  const NCELL = NCX * NCY * NCZ;
  const cellIdx = (i, j, k) => (i * NCY + j) * NCZ + k;
  const cellEdges = new Int32Array(NCELL * 12);
  for (let i = 0; i < NCX; i++) for (let j = 0; j < NCY; j++) for (let k = 0; k < NCZ; k++) {
    const c = cellIdx(i, j, k) * 12;
    let n = 0;
    for (let b = 0; b < 2; b++) for (let d = 0; d < 2; d++) cellEdges[c + n++] = structSpring[gid(i, j + b, k + d) * 3 + 0];
    for (let a = 0; a < 2; a++) for (let d = 0; d < 2; d++) cellEdges[c + n++] = structSpring[gid(i + a, j, k + d) * 3 + 1];
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) cellEdges[c + n++] = structSpring[gid(i + a, j + b, k) * 3 + 2];
  }

  // --- caras: las 6 de cada celda, con sus 4 partículas esquina ---
  const NFACE = NCELL * 6;
  const faceCell   = new Int32Array(NFACE);
  const faceNbCell = new Int32Array(NFACE);
  const faceKind   = new Uint8Array(NFACE);  // 0 = corteza original, 1 = pulpa (cara de corte)
  const faceCorner = new Int32Array(NFACE * 4);
  {
    let f = 0;
    for (let i = 0; i < NCX; i++) for (let j = 0; j < NCY; j++) for (let k = 0; k < NCZ; k++) {
      const c = cellIdx(i, j, k);
      for (let d = 0; d < 6; d++, f++) {
        faceCell[f] = c;
        const [ni, nj, nk] = FACE_NB[d];
        const i2 = i + ni, j2 = j + nj, k2 = k + nk;
        const inside = i2 >= 0 && i2 < NCX && j2 >= 0 && j2 < NCY && k2 >= 0 && k2 < NCZ;
        faceNbCell[f] = inside ? cellIdx(i2, j2, k2) : -1;
        faceKind[f] = inside ? 1 : 0;
        const cs = FACE_CORNERS[d];
        for (let v = 0; v < 4; v++) faceCorner[f * 4 + v] = gid(i + cs[v][0], j + cs[v][1], k + cs[v][2]);
      }
    }
  }

  // --- vecinos estructurales de cada partícula, para el suavizado de render ---
  const nbrP = new Int32Array(N * 6).fill(-1);
  const nbrS = new Int32Array(N * 6).fill(-1);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) for (let k = 0; k < NZ; k++) {
    const g = gid(i, j, k), b = g * 6;
    if (i < NX - 1) { nbrP[b]     = gid(i+1, j, k); nbrS[b]     = structSpring[g * 3]; }
    if (i > 0)      { nbrP[b + 1] = gid(i-1, j, k); nbrS[b + 1] = structSpring[gid(i-1, j, k) * 3]; }
    if (j < NY - 1) { nbrP[b + 2] = gid(i, j+1, k); nbrS[b + 2] = structSpring[g * 3 + 1]; }
    if (j > 0)      { nbrP[b + 3] = gid(i, j-1, k); nbrS[b + 3] = structSpring[gid(i, j-1, k) * 3 + 1]; }
    if (k < NZ - 1) { nbrP[b + 4] = gid(i, j, k+1); nbrS[b + 4] = structSpring[g * 3 + 2]; }
    if (k > 0)      { nbrP[b + 5] = gid(i, j, k-1); nbrS[b + 5] = structSpring[gid(i, j, k-1) * 3 + 2]; }
  }

  function reset() {
    pos.set(rest); prev.set(rest);
    sprAlive.fill(1);
  }
  reset();

  /** Re-deriva la rigidez de cada resorte desde `tune`, para el panel en vivo. */
  function refreshStiffness() {
    const K = stiffnessByType();
    for (let m = 0; m < M; m++) sprK[m] = K[sprType[m]];
  }

  return {
    N, gid, pos, prev, rest,
    M, sprA, sprB, sprRest, sprK, sprType, sprAlive, structSpring, maxSprLen,
    NCELL, cellIdx, cellEdges,
    NFACE, faceCell, faceNbCell, faceKind, faceCorner,
    nbrP, nbrS,
    reset, refreshStiffness,
  };
}
