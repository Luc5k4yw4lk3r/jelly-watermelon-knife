import { NX, NY, NZ } from '../config.js';

/**
 * Volumen de la gelatina: por pieza, y a cada lado de un plano.
 *
 * **Se mide en espacio de reposo.** `rest` no lo escribe nadie después de
 * construirse, así que el volumen de cada celda es una constante y el número no
 * se mueve mientras la gelatina tiembla. Medirlo sobre la malla deformada daría
 * un valor distinto cada frame, que es justo lo que no sirve para puntuar.
 *
 * El reparto contra un plano **recorta los tetraedros**, no clasifica celdas
 * enteras. La diferencia no es cosmética: con las celdas enteras el reparto
 * salta de 50/50 a 39/61 en cuanto el plano cruza una capa de partículas —no
 * existe nada en el medio— y cualquier puntaje de precisión queda sin
 * resolución. Recortando, la curva es continua y se distinguen milímetros.
 *
 * Las distancias al plano se miden sobre las posiciones **deformadas**, que es
 * donde ocurre el corte, y la interpolación se aplica a las coordenadas de
 * **reposo**. Clasificación de un lado, medida del otro: es la misma idea que el
 * backlog propone para la geometría sub-celda de la cara de corte.
 */

/** Descomposición de Freudenthal: 6 tetraedros alrededor de la diagonal 0–6. */
const TETS = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];

// esquinas de la celda en curso: reposo para medir, distancias para clasificar
const cx = new Float64Array(8), cy = new Float64Array(8), cz = new Float64Array(8);
const dist = new Float64Array(8);

function tetVol(a, b, c, d) {
  const ux = cx[b] - cx[a], uy = cy[b] - cy[a], uz = cz[b] - cz[a];
  const vx = cx[c] - cx[a], vy = cy[c] - cy[a], vz = cz[c] - cz[a];
  const wx = cx[d] - cx[a], wy = cy[d] - cy[a], wz = cz[d] - cz[a];
  return (ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx)) / 6;
}

/** Volumen (sin signo) de un tetraedro dado por coordenadas sueltas. */
function absTet(ax, ay, az, bx, by, bz, px, py, pz, dx, dy, dz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = px - ax, vy = py - ay, vz = pz - az;
  const wx = dx - ax, wy = dy - ay, wz = dz - az;
  return Math.abs((ux * (vy * wz - vz * wy) - uy * (vx * wz - vz * wx) + uz * (vx * wy - vy * wx)) / 6);
}

/* Vértices del poliedro recortado: hasta 6 (la cuña del caso 2 contra 2). */
const wx = new Float64Array(6), wy = new Float64Array(6), wz = new Float64Array(6);
/** Copia una esquina del tetraedro al slot `s`. */
function keep(i, s) { wx[s] = cx[i]; wy[s] = cy[i]; wz[s] = cz[i]; }
/** Pone en el slot `s` el punto donde el plano corta la arista `i–j`. */
function crossAt(i, j, s) {
  const t = dist[i] / (dist[i] - dist[j]);
  wx[s] = cx[i] + (cx[j] - cx[i]) * t;
  wy[s] = cy[i] + (cy[j] - cy[i]) * t;
  wz[s] = cz[i] + (cz[j] - cz[i]) * t;
}
/** Tetraedro entre cuatro slots del poliedro recortado. */
const tetW = (a, b, c, d) => absTet(
  wx[a], wy[a], wz[a], wx[b], wy[b], wz[b],
  wx[c], wy[c], wz[c], wx[d], wy[d], wz[d]);

const pos4 = new Int32Array(4), neg4 = new Int32Array(4);

/**
 * Volumen del tetraedro `(a,b,c,d)` que queda del lado `dist > 0`.
 *
 * Tres casos según cuántos vértices quedaron de ese lado:
 *
 *  - **1**: un tetraedro chico, el vértice y los tres cortes.
 *  - **3**: el total menos el tetraedro chico del lado negativo.
 *  - **2**: una cuña de 6 vértices. Se parte en tres tetraedros con la
 *    descomposición estándar de un prisma triangular.
 */
function clipTet(a, b, c, d) {
  let np = 0, nn = 0;
  if (dist[a] > 0) pos4[np++] = a; else neg4[nn++] = a;
  if (dist[b] > 0) pos4[np++] = b; else neg4[nn++] = b;
  if (dist[c] > 0) pos4[np++] = c; else neg4[nn++] = c;
  if (dist[d] > 0) pos4[np++] = d; else neg4[nn++] = d;

  if (np === 4) return Math.abs(tetVol(a, b, c, d));
  if (np === 0) return 0;

  if (np === 1) {
    const p = pos4[0];
    keep(p, 0);
    crossAt(p, neg4[0], 1); crossAt(p, neg4[1], 2); crossAt(p, neg4[2], 3);
    return tetW(0, 1, 2, 3);
  }
  if (np === 3) {
    const n = neg4[0];
    keep(n, 0);
    crossAt(n, pos4[0], 1); crossAt(n, pos4[1], 2); crossAt(n, pos4[2], 3);
    return Math.abs(tetVol(a, b, c, d)) - tetW(0, 1, 2, 3);
  }

  /* Cuña: el triángulo (p0, p0–n0, p0–n1) contra el (p1, p1–n0, p1–n1). Los
     slots se ordenan para que los dos triángulos se correspondan vértice a
     vértice, que es lo que hace válida la descomposición en tres. */
  const p0 = pos4[0], p1 = pos4[1], n0 = neg4[0], n1 = neg4[1];
  keep(p0, 0); crossAt(p0, n0, 1); crossAt(p0, n1, 2);
  keep(p1, 3); crossAt(p1, n0, 4); crossAt(p1, n1, 5);
  return tetW(0, 1, 2, 3) + tetW(1, 2, 3, 4) + tetW(2, 3, 4, 5);
}


/**
 * Volumen del hexaedro `v` (8 esquinas, 24 números) que queda del lado `d > 0`.
 *
 * `d` son las distancias con signo de cada esquina al plano. Puro: lo usa el
 * medidor y lo usan los tests con un cubo de control.
 */
export function hexClip(v, d) {
  for (let i = 0; i < 8; i++) {
    cx[i] = v[i * 3]; cy[i] = v[i * 3 + 1]; cz[i] = v[i * 3 + 2];
    dist[i] = d[i];
  }
  let s = 0;
  for (let t = 0; t < 6; t++) {
    const T = TETS[t];
    s += clipTet(T[0], T[1], T[2], T[3]);
  }
  return s;
}

/** Volumen total del hexaedro `v`. */
export function hexVolume(v) {
  for (let i = 0; i < 8; i++) {
    cx[i] = v[i * 3]; cy[i] = v[i * 3 + 1]; cz[i] = v[i * 3 + 2];
  }
  let s = 0;
  for (let t = 0; t < 6; t++) {
    const T = TETS[t];
    s += Math.abs(tetVol(T[0], T[1], T[2], T[3]));
  }
  return s;
}

export function createVolumeMeter(lat) {
  const { rest, pos } = lat;
  const NCX = NX - 1, NCY = NY - 1, NCZ = NZ - 1;
  const NCELL = NCX * NCY * NCZ;

  /* Las 8 esquinas de cada celda las arma la lattice: también las usa el
     recorte de la cara de corte. */
  const corner = lat.cellCorner;

  /** Carga las 8 esquinas de la celda `c` en reposo. */
  function loadRest(c) {
    const b = c * 8;
    for (let v = 0; v < 8; v++) {
      const o = corner[b + v] * 3;
      cx[v] = rest[o]; cy[v] = rest[o + 1]; cz[v] = rest[o + 2];
    }
  }

  /* ── volumen de cada celda, constante ────────────────────────────────── */

  const cellVol = new Float64Array(NCELL);
  let total = 0;
  for (let c = 0; c < NCELL; c++) {
    loadRest(c);
    let v = 0;
    for (let t = 0; t < 6; t++) {
      const T = TETS[t];
      v += Math.abs(tetVol(T[0], T[1], T[2], T[3]));
    }
    cellVol[c] = v;
    total += v;
  }

  /* ── volumen por pieza ───────────────────────────────────────────────── */

  /**
   * Reparte cada celda entre las piezas de sus 8 esquinas, un octavo cada una.
   *
   * Una celda viva tiene sus 8 esquinas en la misma pieza, así que aporta
   * entera. Las que el corte mató pueden tener esquinas de los dos lados, y
   * aportan en proporción: así la suma sobre todas las piezas sigue dando el
   * total, sin agujero donde pasó la hoja.
   */
  function volumeOfPieces(labelOf, n, out = new Float64Array(n)) {
    out.fill(0);
    const eighth = 1 / 8;
    for (let c = 0; c < NCELL; c++) {
      const b = c * 8, w = cellVol[c] * eighth;
      for (let v = 0; v < 8; v++) {
        const L = labelOf[corner[b + v]];
        if (L >= 0) out[L] += w;
      }
    }
    return out;
  }

  /** Fracción de las esquinas de cada celda que pertenecen a la pieza `label`. */
  function cellWeights(labelOf, label, out = new Float64Array(NCELL)) {
    for (let c = 0; c < NCELL; c++) {
      const b = c * 8;
      let n = 0;
      for (let v = 0; v < 8; v++) if (labelOf[corner[b + v]] === label) n++;
      out[c] = n / 8;
    }
    return out;
  }

  /* ── reparto contra un plano ─────────────────────────────────────────── */

  const _split = [0, 0];

  /**
   * Volumen a cada lado del plano `(p, n)`, en espacio de reposo.
   *
   * @param {Float64Array|null} weight  peso por celda; null = la fruta entera
   * @returns {[number, number]} [lado positivo, lado negativo]. Reusado.
   */
  function splitByPlane(px, py, pz, nx, ny, nz, weight = null) {
    let a = 0, b = 0;
    for (let c = 0; c < NCELL; c++) {
      const w = weight ? weight[c] : 1;
      if (w <= 0) continue;

      const base = c * 8;
      for (let v = 0; v < 8; v++) {
        const p = corner[base + v], o = p * 3;
        cx[v] = rest[o]; cy[v] = rest[o + 1]; cz[v] = rest[o + 2];
        // la clasificación va sobre la posición deformada; la medida, sobre reposo
        dist[v] = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
      }

      let v = 0;
      for (let t = 0; t < 6; t++) {
        const T = TETS[t];
        v += clipTet(T[0], T[1], T[2], T[3]);
      }
      a += w * v;
      b += w * (cellVol[c] - v);
    }
    _split[0] = a; _split[1] = b;
    return _split;
  }

  return {
    NCELL, corner, cellVol, total,
    volumeOfPieces, cellWeights, splitByPlane,
  };
}
