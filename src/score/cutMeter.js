import { VOLUME_TOLERANCE } from '../config.js';

/**
 * Convierte un corte en un puntaje.
 *
 * Junta las tres piezas que ya existen: `pieces` dice **qué se partió en qué**,
 * `volume` dice **cuánto quedó de cada lado**, y `cutScore` pone el número y el
 * rango. Acá solo se las ordena.
 *
 * Dos decisiones que importan:
 *
 *  - El reparto se mide **con el plano**, no contando las celdas que le tocaron
 *    a cada hijo. Contando celdas el número salta de 50/50 a 39/61 sin nada en
 *    el medio (ver `physics/volume.js`); con el plano la curva es continua.
 *  - Se mide **acotado al padre**, no a la sandía entera, así recortar una mitad
 *    por su propio centro puntúa 100 y no 50.
 */
export function createCutMeter({ lat, volume, pieces, scoreboard, onWarn = null }) {
  const { N, pos } = lat;
  const byPiece = new Float64Array(N);   // cota real: no puede haber más piezas que partículas
  const weight = new Float64Array(volume.NCELL);
  const inParent = new Uint8Array(N);
  const _c = [0, 0, 0];

  /** Centroide de una componente, en mundo. */
  function centroid(label, out) {
    let x = 0, y = 0, z = 0, n = 0;
    for (let p = 0; p < N; p++) {
      if (pieces.label[p] !== label) continue;
      const o = p * 3;
      x += pos[o]; y += pos[o + 1]; z += pos[o + 2]; n++;
    }
    const k = n ? 1 / n : 0;
    out[0] = x * k; out[1] = y * k; out[2] = z * k;
    return n;
  }

  /** Peso por celda: fracción de esquinas que eran del padre. */
  function parentWeights(labels) {
    inParent.fill(0);
    for (let p = 0; p < N; p++) {
      for (let i = 0; i < labels.length; i++) {
        if (pieces.label[p] === labels[i]) { inParent[p] = 1; break; }
      }
    }
    const { corner, NCELL } = volume;
    for (let c = 0; c < NCELL; c++) {
      const b = c * 8;
      let n = 0;
      for (let v = 0; v < 8; v++) if (inParent[corner[b + v]]) n++;
      weight[c] = n / 8;
    }
    return weight;
  }

  /**
   * Puntúa todos los splits de un golpe.
   *
   * @param {Array<{parent:number, children:number[], labels:number[]}>} events
   * @param {{px:number,py:number,pz:number,nx:number,ny:number,nz:number}} plane
   * @param {string} source
   * @returns {{entries:Array, avg:number, anchors:Array}|null}
   */
  function measure(events, plane, source) {
    if (!events.length) return null;

    const splits = [];
    const anchors = [];

    for (const ev of events) {
      const w = parentWeights(ev.labels);
      const [a, b] = volume.splitByPlane(plane.px, plane.py, plane.pz,
                                         plane.nx, plane.ny, plane.nz, w);

      /* Comprobación cruzada: el volumen del padre se puede obtener de dos
         maneras independientes —el reparto contra el plano, y la suma de las
         celdas repartidas por esquinas entre sus hijos—. Si no coinciden, hay un
         error de geometría y es mejor enterarse. */
      if (onWarn) {
        const vols = volume.volumeOfPieces(pieces.label, pieces.nLabels, byPiece);
        let fromCells = 0;
        for (const L of ev.labels) fromCells += vols[L];
        const rel = Math.abs((a + b) - fromCells) / (fromCells || 1);
        if (rel > VOLUME_TOLERANCE) {
          onWarn(`volumen inconsistente: plano ${(a + b).toFixed(4)} vs celdas `
               + `${fromCells.toFixed(4)} (${(100 * rel).toFixed(1)}%)`);
        }
      }

      /* A qué lado cayó cada hijo lo dice el signo de su centroide contra el
         plano. Con más de dos hijos —el corte soltó migas— los de un mismo lado
         comparten ese volumen: el puntaje es del plano, no de cada miga. */
      let posLabel = -1, negLabel = -1, posBest = 0, negBest = 0;
      for (let i = 0; i < ev.labels.length; i++) {
        const L = ev.labels[i];
        const n = centroid(L, _c);
        const d = (_c[0] - plane.px) * plane.nx
                + (_c[1] - plane.py) * plane.ny
                + (_c[2] - plane.pz) * plane.nz;
        if (d > 0) { if (n > posBest) { posBest = n; posLabel = L; } }
        else if (n > negBest) { negBest = n; negLabel = L; }
      }

      const idOfLabel = (L) => (L >= 0 ? pieces.idOfLabel(L) : -1);
      splits.push({
        parent: ev.parent,
        children: [idOfLabel(posLabel), idOfLabel(negLabel)],
        volumes: [a, b],
      });

      const pair = [];
      for (const L of [posLabel, negLabel]) {
        if (L < 0) { pair.push(null); continue; }
        centroid(L, _c);
        pair.push([_c[0], _c[1], _c[2]]);
      }
      anchors.push(pair);
    }

    const played = scoreboard.record(splits, source);
    return { ...played, anchors };
  }

  return { measure };
}
