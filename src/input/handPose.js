import { makeOneEuro } from './oneEuro.js';

export const HANDS = 2;
export const LOST_AFTER_MS = 180;

/** Pares de landmarks que dibuja el preview. */
export const HAND_LINKS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

/**
 * Landmarks crudos → pose de la hoja. **Sin DOM y sin MediaPipe.**
 *
 * Toda la lógica no trivial del tracking vive acá, separada de lo que necesita
 * hardware: asignación de slots, suavizado, pérdida y reaparición de la mano.
 * Eso es lo que la hace testeable sin cámara, y lo que permite reproducir una
 * sesión grabada (ver input/replay.js).
 *
 * Dos manos, dos cuchillos. Slot 0 es la mano izquierda, slot 1 la derecha. La
 * asignación va por la handedness que reporta MediaPipe y **no** por el orden
 * del array, que no es estable entre frames: con el orden, los cuchillos se
 * intercambian solos.
 */
export function createHandPose() {
  const euro = [makeOneEuro(42, 1.6, 0.9, 1.0), makeOneEuro(42, 1.6, 0.9, 1.0)];
  const lm = new Float32Array(HANDS * 42);   // landmarks suavizados (normalizados, 21 x xy)
  const seen = [false, false];
  const lastAt = [-1e9, -1e9];

  /**
   * Consume un frame de detección.
   *
   * @param {number} t         marca de tiempo en ms
   * @param {Array}  hands     por mano, 21 puntos `{x, y}` normalizados
   * @param {Array}  handed    por mano, la handedness que reportó MediaPipe
   * @returns {boolean}        si hay al menos una mano
   */
  function pushFrame(t, hands, handed) {
    const taken = [false, false];

    if (hands && hands.length) {
      for (let h = 0; h < hands.length && h < HANDS; h++) {
        const label = handed && handed[h] && handed[h][0] && handed[h][0].categoryName;
        let slot = label === 'Left' ? 0 : 1;
        if (taken[slot]) slot = 1 - slot;      // ambas con la misma etiqueta
        if (taken[slot]) continue;
        taken[slot] = true;

        const pts = hands[h];
        const base = slot * 42;
        const dt = seen[slot] ? Math.min(0.1, Math.max(1 / 120, (t - lastAt[slot]) / 1000)) : 1 / 30;
        // una mano que reaparece arranca el filtro de cero: si no, la pose salta
        // desde donde estaba la mano la última vez que se la vio
        if (!seen[slot]) euro[slot].reset();
        for (let i = 0; i < 21; i++) {
          lm[base + i * 2]     = euro[slot].filter(i * 2,     pts[i].x, dt);
          lm[base + i * 2 + 1] = euro[slot].filter(i * 2 + 1, pts[i].y, dt);
        }
        seen[slot] = true;
        lastAt[slot] = t;
      }
    }

    // se tolera una pérdida corta antes de dar la mano por ida, para que un
    // frame suelto sin detección no haga parpadear el cuchillo
    for (let slot = 0; slot < HANDS; slot++) {
      if (!taken[slot] && t - lastAt[slot] > LOST_AFTER_MS) seen[slot] = false;
    }

    return seen[0] || seen[1];
  }

  function reset() {
    seen[0] = seen[1] = false;
    lastAt[0] = lastAt[1] = -1e9;
    euro[0].reset(); euro[1].reset();
  }

  const _p0 = { x: 0, y: 0 }, _p1 = { x: 0, y: 0 };
  const poses = [
    { gx: 0, gy: 0, dirx: 0, diry: 1 },
    { gx: 0, gy: 0, dirx: 0, diry: 1 },
  ];
  const out = [null, null];

  /**
   * Posición desde el punto medio muñeca–nudillo del índice; orientación desde
   * ese mismo vector. La X se espeja para que mover la mano a la derecha mueva
   * el cuchillo a la derecha.
   *
   * @returns {Array<null|{gx:number,gy:number,dirx:number,diry:number}>}
   */
  function getPoses(ndcToPlane) {
    for (let slot = 0; slot < HANDS; slot++) {
      if (!seen[slot]) { out[slot] = null; continue; }
      const base = slot * 42;
      ndcToPlane(1 - 2 * lm[base],      1 - 2 * lm[base + 1],  _p0);
      ndcToPlane(1 - 2 * lm[base + 10], 1 - 2 * lm[base + 11], _p1);
      let dx = _p1.x - _p0.x, dy = _p1.y - _p0.y;
      const l = Math.hypot(dx, dy);
      if (l > 1e-4) { dx /= l; dy /= l; } else { dx = 0; dy = 1; }
      const pose = poses[slot];
      pose.gx = (_p0.x + _p1.x) * 0.5;
      pose.gy = (_p0.y + _p1.y) * 0.5;
      pose.dirx = dx; pose.diry = dy;
      out[slot] = pose;
    }
    return out;
  }

  return { pushFrame, reset, getPoses, landmarks: lm, seen };
}
