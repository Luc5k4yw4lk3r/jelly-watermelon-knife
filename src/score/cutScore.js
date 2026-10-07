import { GRADES } from '../config.js';

/**
 * Puntaje de un corte: qué proporción quedó de cada lado y qué tan cerca estuvo
 * del 50/50.
 *
 * Módulo **puro**: números entran, números salen. Sin DOM, sin Three, sin física.
 * Por eso se prueba en Node en milisegundos, igual que `fsm.js` y `cutPlane.js`.
 *
 * El puntaje siempre es **relativo a la pieza que se cortó**, no a la sandía
 * entera: así recortar una mitad por el medio puntúa 100, que es lo que el
 * jugador acaba de hacer bien.
 */

/** Rango que le corresponde a una precisión. */
export function gradeOf(precision) {
  for (const g of GRADES) if (precision >= g.min) return g.name;
  return GRADES[GRADES.length - 1].name;
}

/**
 * Mide un corte a partir de los volúmenes resultantes.
 *
 * @param {number[]} volumes  volumen de cada hijo; se puntúan los dos mayores
 * @returns {{ratio:number, split:number[], precision:number, grade:string}}
 */
export function scoreSplit(volumes) {
  const total = volumes.reduce((a, b) => a + b, 0);
  const split = total > 0 ? volumes.map((v) => (100 * v) / total) : volumes.map(() => 0);

  /* Con más de dos hijos —el corte soltó migas— el puntaje mira los dos
     grandes: es lo que el jugador ve como "las dos mitades". Las migas siguen
     contando en los porcentajes, que por eso suman 100 igual. */
  const [big, small] = [...volumes].sort((a, b) => b - a);
  const a = big || 0, b = small || 0;
  const ratio = a > 0 ? b / a : 0;
  const precision = a + b > 0 ? round1(100 * (1 - Math.abs(a - b) / (a + b))) : 0;

  return { ratio, split, precision, grade: gradeOf(precision) };
}

const round1 = (v) => Math.round(v * 10) / 10;

/**
 * Historial y estadísticas de la sesión.
 *
 * Una "jugada" es un golpe: puede partir varias piezas a la vez, así que se
 * registran todas y se devuelve además el promedio de esa jugada.
 */
export function createScoreboard() {
  const history = [];
  let nextId = 1;
  let best = null;
  let sum = 0;

  /**
   * @param {Array<{parent:number, children:number[], volumes:number[]}>} splits
   * @param {string} source  'mouse' | 'hand' | 'replay'
   */
  function record(splits, source = 'mouse') {
    const entries = [];
    for (const s of splits) {
      const score = scoreSplit(s.volumes);
      const entry = {
        id: nextId++,
        timestamp: Date.now(),
        parentPieceId: s.parent,
        childIds: s.children,
        volumes: s.volumes,
        split: score.split,
        ratio: score.ratio,
        precision: score.precision,
        grade: score.grade,
        inputSource: source,
      };
      history.push(entry);
      entries.push(entry);
      sum += entry.precision;
      if (best === null || entry.precision > best) best = entry.precision;
    }
    const avg = entries.length
      ? round1(entries.reduce((a, e) => a + e.precision, 0) / entries.length)
      : 0;
    return { entries, avg };
  }

  function stats() {
    const n = history.length;
    return {
      count: n,
      last: n ? history[n - 1].precision : null,
      lastGrade: n ? history[n - 1].grade : null,
      best,
      avg: n ? round1(sum / n) : null,
    };
  }

  function reset() {
    history.length = 0;
    nextId = 1;
    best = null;
    sum = 0;
  }

  return { record, stats, reset, history };
}
