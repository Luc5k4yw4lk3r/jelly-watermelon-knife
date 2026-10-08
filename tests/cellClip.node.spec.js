import { test, expect } from '@playwright/test';
import { capPolygon, clipFace, CELL_CORNERS, CELL_FACES } from '../src/physics/cellClip.js';
import { NY, NZ } from '../src/config.js';
import { createLattice } from '../src/physics/lattice.js';

/**
 * Recorte de una celda contra el plano de corte, en Node y sin navegador.
 *
 * La sección es geometría: se prueba contra figuras de respuesta conocida antes
 * de creerle nada sobre la sandía, igual que el recorte de volumen.
 */

/** Las 8 esquinas del cubo unitario, en el orden que esperan las celdas. */
const CUBE = [
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
];
/** Distancias al plano x = t, por esquina. */
const atX = (t) => Array.from({ length: 8 }, (_, i) => CUBE[i * 3] - t);

/** Buffers de salida, del tamaño máximo que puede tener una sección. */
const buf = () => [new Int32Array(8), new Int32Array(8), new Float64Array(8)];

/** El vértice `v` de la sección, en coordenadas del cubo. */
function vertexAt(A, B, T, v, corner = CUBE) {
  const a = A[v] * 3, b = B[v] * 3, t = T[v];
  return [0, 1, 2].map((k) => corner[a + k] + (corner[b + k] - corner[a + k]) * t);
}

/**
 * Área del polígono, por la fórmula de Newell.
 *
 * Mide lo que un área no puede medir si los vértices están desordenados: un
 * polígono en zigzag con los mismos vértices da otro número. Por eso la
 * aserción es sobre el área y no sobre el conjunto de vértices.
 */
function capArea(n, A, B, T) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const p = vertexAt(A, B, T, i);
    const q = vertexAt(A, B, T, (i + 1) % n);
    nx += p[1] * q[2] - p[2] * q[1];
    ny += p[2] * q[0] - p[0] * q[2];
    nz += p[0] * q[1] - p[1] * q[0];
  }
  return Math.hypot(nx, ny, nz) / 2;
}

test('el cubo de control cortado en x = t deja una sección de área 1', () => {
  for (const t of [0.1, 0.5, 0.9]) {
    const [A, B, T] = buf();
    const n = capPolygon(CUBE, atX(t), 1, 0, 0, A, B, T);

    expect(n).toBe(4);
    expect(capArea(n, A, B, T)).toBeCloseTo(1, 12);
  }
});

test('un plano oblicuo por el centro deja el hexágono regular', () => {
  /* x + y + z = 1.5 pasa por los puntos medios de seis aristas, así que la
     sección es un hexágono regular de lado √0.5 y área 3√3/4. Es el caso que
     más fácil sale mal: con los vértices desordenados el área es otra. */
  const k = 1 / Math.sqrt(3);
  const diag = Array.from({ length: 8 }, (_, i) =>
    CUBE[i * 3] + CUBE[i * 3 + 1] + CUBE[i * 3 + 2] - 1.5);

  const [A, B, T] = buf();
  const n = capPolygon(CUBE, diag, k, k, k, A, B, T);

  expect(n).toBe(6);
  expect(capArea(n, A, B, T)).toBeCloseTo((3 * Math.sqrt(3)) / 4, 12);
});

test('un plano que no toca la celda no deja sección', () => {
  const [A, B, T] = buf();
  expect(capPolygon(CUBE, atX(1.5), 1, 0, 0, A, B, T)).toBe(0);
  expect(capPolygon(CUBE, atX(-0.5), 1, 0, 0, A, B, T)).toBe(0);
});

test('el recorte de una cara reparte su área entre los dos lados', () => {
  /* Las caras laterales también hay que recortarlas: si no, la sección queda
     plana pero rodeada de una muesca escalonada de media celda. Lo que no puede
     pasar es que el recorte invente o pierda superficie. */
  const dist = atX(0.37);
  const [A, B, T] = buf();

  for (let face = 0; face < 6; face++) {
    const nPos = clipFace(CUBE, dist, face, +1, A, B, T);
    const areaPos = nPos ? capArea(nPos, A, B, T) : 0;

    const nNeg = clipFace(CUBE, dist, face, -1, A, B, T);
    const areaNeg = nNeg ? capArea(nNeg, A, B, T) : 0;

    expect(areaPos + areaNeg).toBeCloseTo(1, 12);
  }
});

test('las caras del recorte son las mismas que arma la lattice', () => {
  /* Si los dos órdenes se separan, el render sale mal y nada se pone en rojo:
     las caras se dibujarían con las partículas de otra cara. Esta aserción es
     la que impide que un reordenamiento futuro lo rompa en silencio. */
  const lat = createLattice();
  const gid = (i, j, k) => (i * NY + j) * NZ + k;
  const cellIdx = (i, j, k) => (i * (NY - 1) + j) * (NZ - 1) + k;
  const [i, j, k] = [3, 4, 5];

  for (let d = 0; d < 6; d++) {
    const f = cellIdx(i, j, k) * 6 + d;
    for (let v = 0; v < 4; v++) {
      const c = CELL_CORNERS[CELL_FACES[d * 4 + v]];
      expect(gid(i + c[0], j + c[1], k + c[2])).toBe(lat.faceCorner[f * 4 + v]);
    }
  }
});
