/**
 * Recorte de una celda contra el plano de corte.
 *
 * Devuelve **referencias, no coordenadas**: cada vértice de la sección es el
 * punto donde el plano cruza la arista `a–b` de la celda, con su parámetro `t`.
 * Esa es la clave de que la cara acompañe la deformación sin recalcular nada:
 * `t` se computa una sola vez y después se interpola con las posiciones del
 * frame, igual que el medidor de volumen interpola las de reposo.
 *
 * Módulo **puro**: números entran, números salen. Sin DOM, sin three, sin
 * lattice, y por eso se prueba en Node contra un cubo de respuesta conocida.
 */

/**
 * Las 8 esquinas de una celda como desplazamientos `(di, dj, dk)`, en el mismo
 * orden que espera `hexClip` en `volume.js`. Que este orden y el de la lattice
 * coincidan no es decorativo: si se separan, las caras se dibujan con las
 * partículas de otra cara y nada se pone en rojo. Hay un test que lo ancla.
 */
export const CELL_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/** Las 12 aristas del hexaedro, como pares de esquina. */
const EDGES = new Int32Array([
  0, 1, 1, 2, 2, 3, 3, 0,     // cara z = 0
  4, 5, 5, 6, 6, 7, 7, 4,     // cara z = 1
  0, 4, 1, 5, 2, 6, 3, 7,     // verticales
]);

/**
 * Las 6 caras, 4 esquinas cada una, en el mismo orden y bobinado que
 * `FACE_CORNERS` de `lattice.js`: +x, −x, +y, −y, +z, −z.
 */
export const CELL_FACES = new Int32Array([
  1, 2, 6, 5,
  0, 4, 7, 3,
  3, 7, 6, 2,
  0, 1, 5, 4,
  4, 5, 6, 7,
  0, 3, 2, 1,
]);

/* Un plano no corta más de 6 aristas de un hexaedro convexo; 8 da aire. */
const vx = new Float64Array(8), vy = new Float64Array(8), vz = new Float64Array(8);
const ang = new Float64Array(8);

/**
 * Polígono de sección de una celda contra un plano.
 *
 * Los vértices salen **ordenados** alrededor de la normal, que es lo que los
 * vuelve un polígono y no una nube: con los cruces en el orden en que aparecen
 * las aristas, un corte por el medio del cubo da un lazo cruzado de área cero.
 *
 * @param {ArrayLike<number>} corner  24 números: las 8 esquinas de la celda
 * @param {ArrayLike<number>} dist    8 distancias con signo al plano
 * @param {number} nx @param {number} ny @param {number} nz  normal del plano
 * @param {Int32Array} outA @param {Int32Array} outB @param {Float64Array} outT
 * @returns {number} vértices del polígono, o 0 si el plano no corta la celda
 */
export function capPolygon(corner, dist, nx, ny, nz, outA, outB, outT) {
  let n = 0;
  for (let e = 0; e < 12; e++) {
    const a = EDGES[e * 2], b = EDGES[e * 2 + 1];
    const da = dist[a], db = dist[b];
    if ((da > 0) === (db > 0)) continue;

    const t = da / (da - db);
    const oa = a * 3, ob = b * 3;
    outA[n] = a; outB[n] = b; outT[n] = t;
    vx[n] = corner[oa]     + (corner[ob]     - corner[oa])     * t;
    vy[n] = corner[oa + 1] + (corner[ob + 1] - corner[oa + 1]) * t;
    vz[n] = corner[oa + 2] + (corner[ob + 2] - corner[oa + 2]) * t;
    n++;
  }
  if (n < 3) return 0;

  /* Base del plano para medir ángulos. El eje de apoyo es aquel en el que la
     normal es más chica: cruzarla con el eje más paralelo daría un vector
     degenerado. */
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  let sx = 0, sy = 0, sz = 0;
  if (ax <= ay && ax <= az) sx = 1; else if (ay <= az) sy = 1; else sz = 1;

  let ux = ny * sz - nz * sy, uy = nz * sx - nx * sz, uz = nx * sy - ny * sx;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;

  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += vx[i]; cy += vy[i]; cz += vz[i]; }
  cx /= n; cy /= n; cz /= n;

  for (let i = 0; i < n; i++) {
    const dx = vx[i] - cx, dy = vy[i] - cy, dz = vz[i] - cz;
    ang[i] = Math.atan2(dx * wx + dy * wy + dz * wz, dx * ux + dy * uy + dz * uz);
  }

  /* Inserción: son 6 vértices a lo sumo, y mantiene los cuatro arrays juntos. */
  for (let i = 1; i < n; i++) {
    const ka = outA[i], kb = outB[i], kt = outT[i], kang = ang[i];
    let j = i - 1;
    while (j >= 0 && ang[j] > kang) {
      outA[j + 1] = outA[j]; outB[j + 1] = outB[j];
      outT[j + 1] = outT[j]; ang[j + 1] = ang[j];
      j--;
    }
    outA[j + 1] = ka; outB[j + 1] = kb; outT[j + 1] = kt; ang[j + 1] = kang;
  }

  return n;
}

/**
 * Recorte de una cara de la celda: la parte que queda del lado `side`.
 *
 * Es Sutherland–Hodgman sobre el cuadrilátero, que conserva el bobinado de
 * entrada, así que la cara recortada mira para el mismo lado que la original.
 * Sin esto la sección queda plana pero rodeada de una muesca escalonada: el
 * verde de la corteza se corta media celda antes de llegar al plano.
 *
 * Una esquina que queda se escribe como `(a, a, 0)`: el vértice es la partícula
 * misma, y el que interpola después no necesita una rama para distinguirla.
 *
 * @param {ArrayLike<number>} corner  24 números: las 8 esquinas de la celda
 * @param {ArrayLike<number>} dist    8 distancias con signo al plano
 * @param {number} face               cara 0..5, en el orden de `CELL_FACES`
 * @param {number} side               +1 conserva `dist > 0`; −1, el otro lado
 * @returns {number} vértices escritos, 0 si de ese lado no queda nada
 */
export function clipFace(corner, dist, face, side, outA, outB, outT) {
  const base = face * 4;
  let n = 0;
  for (let e = 0; e < 4; e++) {
    const a = CELL_FACES[base + e], b = CELL_FACES[base + (e + 1) % 4];
    const da = dist[a] * side, db = dist[b] * side;
    const inA = da > 0, inB = db > 0;

    if (inA) { outA[n] = a; outB[n] = a; outT[n] = 0; n++; }
    if (inA !== inB) {
      outA[n] = a; outB[n] = b; outT[n] = da / (da - db); n++;
    }
  }
  return n < 3 ? 0 : n;
}
