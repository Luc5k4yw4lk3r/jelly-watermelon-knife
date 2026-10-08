import { NX, NY, NZ } from '../config.js';
import { capPolygon, clipFace } from './cellClip.js';

/**
 * Geometría sub-celda de la cara de corte.
 *
 * Hoy una celda muere si pierde cualquiera de sus 12 aristas estructurales, así
 * que el tajo se lleva la capa entera que atraviesa y la cara expuesta queda en
 * escalera de media celda. Acá esa celda, en vez de desaparecer, se **recorta
 * contra el plano**: la sección cae exactamente sobre el plano del corte.
 *
 * Los vértices se guardan como **referencias** —la arista `ancla–otra` y su
 * parámetro `t`—, nunca como coordenadas. Con eso:
 *
 *  - la posición de reposo es constante y se calcula una sola vez;
 *  - la posición del frame sale de interpolar lo que haya en `pos`, así que la
 *    cara acompaña la deformación sin corrección por frame;
 *  - el **ancla es la partícula del lado que se conserva**, que es lo que evita
 *    que la cara se estire como una membrana cuando las mitades se separan.
 *
 * No toca la física: lee `pos` y `rest`, y no escribe nada de la simulación.
 */

const NCX = NX - 1, NCY = NY - 1, NCZ = NZ - 1;
const NCELL = NCX * NCY * NCZ;

/* Por celda y por lado: la sección (≤6 vértices) y sus 6 paredes (≤5 cada una).
   Nunca se llena ni de cerca —un tajo toca el 9% de las celdas— pero reservarlo
   una vez evita decidir nada en caliente. */
const MAX_VERT = NCELL * 2 * (6 + 6 * 5);

export function createCutGeometry(lat) {
  const { pos, rest, cellCorner, faceNbCell, faceKind } = lat;

  const dist = new Float64Array(8);
  const corner = new Float64Array(24);
  /* La sección y las paredes no pueden compartir buffer: las paredes se
     recortan entre el lado + y el lado −, y le pisarían la sección al segundo. */
  const secA = new Int32Array(8), secB = new Int32Array(8), secT = new Float64Array(8);
  const facA = new Int32Array(8), facB = new Int32Array(8), facT = new Float64Array(8);

  /* Por vértice: el ancla, la otra punta de la arista y el parámetro desde el
     ancla. Una esquina se escribe como `(a, a, 0)`, y entonces interpolar
     devuelve la partícula misma: un solo camino, sin ramas. */
  const vAnchor = new Int32Array(MAX_VERT);
  const vOther = new Int32Array(MAX_VERT);
  const vT = new Float32Array(MAX_VERT);
  const vRest = new Float32Array(MAX_VERT * 3);
  const vPos = new Float32Array(MAX_VERT * 3);

  const polyStart = new Int32Array(MAX_VERT / 3);
  const polyLen = new Int32Array(MAX_VERT / 3);
  /* De qué lado del plano quedó cada sección. Las dos coinciden al nacer, pero
     cada una se ancla a las partículas de su mitad y a partir de ahí viajan por
     separado. */
  const polySide = new Int8Array(MAX_VERT / 3);
  /** La sección va sobre el plano; las paredes son el resto del remanente. */
  const polyIsSection = new Uint8Array(MAX_VERT / 3);
  /** 0 corteza, 1 pulpa: lo mismo que `faceKind`, y lo que el shader colorea. */
  const polyKind = new Uint8Array(MAX_VERT / 3);

  /** Qué celdas recortó este corte: una pared contra una de ellas es interior. */
  const cellCut = new Uint8Array(NCELL);

  let nVert = 0, nPoly = 0;

  /**
   * Recorta contra `plane` las celdas que este corte mató.
   *
   * @param {{px:number,py:number,pz:number,nx:number,ny:number,nz:number}} plane
   * @param {{cellSolid:Uint8Array}} topo
   */
  function rebuild(plane, topo) {
    const { cellSolid } = topo;
    const { px, py, pz, nx, ny, nz } = plane;
    nVert = 0; nPoly = 0;
    cellCut.fill(0);

    for (let c = 0; c < NCELL; c++) {
      if (cellSolid[c]) continue;                 // viva: la dibuja la malla de siempre

      /* Clasificar sobre las posiciones **deformadas**, que es donde ocurrió el
         corte, e interpolar sobre las de reposo. Es la misma regla que ya usa el
         medidor de volumen. */
      const b = c * 8;
      let npos = 0;
      for (let v = 0; v < 8; v++) {
        const o = cellCorner[b + v] * 3;
        dist[v] = (pos[o] - px) * nx + (pos[o + 1] - py) * ny + (pos[o + 2] - pz) * nz;
        if (dist[v] > 0) npos++;
      }
      /* Murió por otra causa —otro tajo, o el borde de este— y el plano ni la
         toca: no hay sección que dibujar. */
      if (npos === 0 || npos === 8) continue;

      for (let v = 0; v < 8; v++) {
        const o = cellCorner[b + v] * 3;
        corner[v * 3] = rest[o]; corner[v * 3 + 1] = rest[o + 1]; corner[v * 3 + 2] = rest[o + 2];
      }

      const n = capPolygon(corner, dist, nx, ny, nz, secA, secB, secT);
      if (!n) continue;
      cellCut[c] = 1;

      /* Una sección por lado: cada mitad se lleva la suya, anclada a sus propias
         partículas. */
      for (const side of [1, -1]) {
        polyStart[nPoly] = nVert;
        polyLen[nPoly] = n;
        polySide[nPoly] = side;
        polyIsSection[nPoly] = 1;
        polyKind[nPoly] = 1;                 // la sección siempre es pulpa
        nPoly++;
        for (let i = 0; i < n; i++) {
          const a = secA[i], d = secB[i], t = secT[i];
          /* El ancla es la esquina que quedó del lado que se conserva. */
          const keepA = (dist[a] > 0) === (side > 0);
          const pa = cellCorner[b + (keepA ? a : d)];
          const pb = cellCorner[b + (keepA ? d : a)];
          vAnchor[nVert] = pa;
          vOther[nVert] = pb;
          vT[nVert] = keepA ? t : 1 - t;

          const oa = pa * 3, ob = pb * 3, tt = vT[nVert], o3 = nVert * 3;
          vRest[o3]     = rest[oa]     + (rest[ob]     - rest[oa])     * tt;
          vRest[o3 + 1] = rest[oa + 1] + (rest[ob + 1] - rest[oa + 1]) * tt;
          vRest[o3 + 2] = rest[oa + 2] + (rest[ob + 2] - rest[oa + 2]) * tt;
          nVert++;
        }

        /* Las paredes del remanente. Sin ellas la sección queda flotando: entre
           la fruta que sobrevivió y el plano hay una capa de celda que el tajo
           se comió y que nadie dibuja. */
        for (let d = 0; d < 6; d++) {
          const f = c * 6 + d;
          const nb = faceNbCell[f];
          /* Hacia adentro de la fruta no hay nada que mostrar: o la vecina está
             viva —y entonces el remanente se le apoya— o también se recortó y su
             propia pared tapa esta. Lo que se dibuja es lo que da al aire: el
             borde de la lattice, o un hueco que dejó otro corte. */
          if (nb >= 0 && (cellSolid[nb] || cellCut[nb])) continue;

          const m = clipFace(corner, dist, d, side, facA, facB, facT);
          if (!m) continue;
          polyStart[nPoly] = nVert;
          polyLen[nPoly] = m;
          polySide[nPoly] = side;
          polyIsSection[nPoly] = 0;
          polyKind[nPoly] = faceKind[f];
          nPoly++;
          for (let i = 0; i < m; i++) {
            const a = facA[i], e = facB[i], t = facT[i];
            const keepA = a === e || (dist[a] > 0) === (side > 0);
            const pa = cellCorner[b + (keepA ? a : e)];
            const pb = cellCorner[b + (keepA ? e : a)];
            const tt = a === e ? 0 : (keepA ? t : 1 - t);
            vAnchor[nVert] = pa; vOther[nVert] = pb; vT[nVert] = tt;
            const oa = pa * 3, ob = pb * 3, o3 = nVert * 3;
            vRest[o3]     = rest[oa]     + (rest[ob]     - rest[oa])     * tt;
            vRest[o3 + 1] = rest[oa + 1] + (rest[ob + 1] - rest[oa + 1]) * tt;
            vRest[o3 + 2] = rest[oa + 2] + (rest[ob + 2] - rest[oa + 2]) * tt;
            nVert++;
          }
        }
      }
    }
    return nPoly;
  }

  /**
   * Recalcula dónde está cada vértice este frame.
   *
   * No interpola entre las dos puntas de la arista: eso cruzaría el plano y la
   * cara se estiraría entre las dos mitades. Cada vértice cuelga de **su**
   * ancla, con el desplazamiento de reposo rotado por la transformación de la
   * pieza a la que esa ancla pertenece. El desplazamiento mide media arista como
   * mucho, así que el vértice queda donde estaría la gelatina si hubiera una
   * partícula ahí.
   *
   * @param {{compOf:Int32Array, compT:Float64Array}} shape
   * @param {ArrayLike<number>} src  posiciones a usar; por defecto las de la
   *   simulación, pero el render pasa las suavizadas para pegar sin costura con
   *   el resto de la malla.
   */
  function update(shape, src = pos) {
    const { compOf, compT } = shape;
    for (let i = 0; i < nVert; i++) {
      const a = vAnchor[i];
      const oa = a * 3, o3 = i * 3;
      const qx = vRest[o3] - rest[oa];
      const qy = vRest[o3 + 1] - rest[oa + 1];
      const qz = vRest[o3 + 2] - rest[oa + 2];

      const c = compOf[a];
      if (c < 0) {
        /* Miga más chica que SM_MIN: no tiene forma objetivo ni transformación,
           así que el desplazamiento va sin rotar. */
        vPos[o3] = src[oa] + qx;
        vPos[o3 + 1] = src[oa + 1] + qy;
        vPos[o3 + 2] = src[oa + 2] + qz;
        continue;
      }
      const m = c * 9;
      vPos[o3]     = src[oa]     + compT[m]     * qx + compT[m + 1] * qy + compT[m + 2] * qz;
      vPos[o3 + 1] = src[oa + 1] + compT[m + 3] * qx + compT[m + 4] * qy + compT[m + 5] * qz;
      vPos[o3 + 2] = src[oa + 2] + compT[m + 6] * qx + compT[m + 7] * qy + compT[m + 8] * qz;
    }
  }

  /**
   * Las posiciones de reposo **de la sección**: lo que mide la planaridad.
   *
   * Las paredes quedan afuera a propósito: son superficie legítima de la pieza
   * —van de la fruta al plano— y meterlas infla el número hasta que deja de
   * decir nada sobre lo plana que quedó la cara.
   */
  const secPts = new Float64Array(MAX_VERT * 3);
  function sectionRest() {
    let k = 0;
    for (let p = 0; p < nPoly; p++) {
      if (!polyIsSection[p]) continue;
      for (let i = 0; i < polyLen[p]; i++) {
        const o = (polyStart[p] + i) * 3;
        secPts[k++] = vRest[o]; secPts[k++] = vRest[o + 1]; secPts[k++] = vRest[o + 2];
      }
    }
    return secPts.subarray(0, k);
  }

  return {
    rebuild, update, sectionRest,
    get nVert() { return nVert; },
    get nPoly() { return nPoly; },
    vAnchor, vOther, vT, vRest, vPos, polyStart, polyLen, polySide,
    polyIsSection, polyKind,
  };
}
