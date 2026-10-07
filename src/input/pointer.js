/**
 * Capa de puntero unificada: mouse, táctil y mano terminan en la misma forma.
 *
 *   { nx, ny, pressed, pinch, source }      por slot, o null si no hay puntero
 *
 * `nx`/`ny` están en NDC (−1..1), ya espejados en el caso de la mano. Las dos
 * mecánicas consumen esto, así que una no tiene que saber de dónde viene el
 * gesto. Los dos slots existen porque el tracking reporta hasta dos manos; con
 * mouse solo se usa el 0.
 */
const EMPTY = [null, null];

export function createPointers({ mouse, hand, replay }) {
  const mp = { nx: 0, ny: 0, pressed: false, pinch: 1, source: 'mouse' };
  const out = [null, null];

  function get(source) {
    if (source === 'hand') return hand.getPointers();
    if (source === 'replay') return replay.getPointers();
    if (source === 'mouse' && mouse.state.seen) {
      mp.nx = mouse.state.nx;
      mp.ny = mouse.state.ny;
      mp.pressed = mouse.state.pressed;
      out[0] = mp;
      return out;
    }
    out[0] = null;
    return EMPTY;
  }

  return { get };
}
