/**
 * Fallback a mouse, con la misma interfaz de pose que el tracking de mano.
 *
 * El cuchillo apunta hacia donde va: viajar sobre su propio eje es lo que
 * mantiene el área barrida como una astilla fina. Si apuntara perpendicular al
 * movimiento, el barrido sería un rectángulo tan ancho como larga la hoja y el
 * cuchillo excavaría la sandía en vez de rebanarla.
 */
export function createMouse(canvas) {
  const state = { nx: 0, ny: 0, seen: false, pressed: false, dirx: 0, diry: 1 };

  addEventListener('pointermove', (e) => {
    state.nx = (e.clientX / innerWidth) * 2 - 1;
    state.ny = -((e.clientY / innerHeight) * 2 - 1);
    state.seen = true;
  }, { passive: true });
  addEventListener('pointerleave', () => { state.seen = false; });

  /* El "presionado" que consume la capa de puntero.
     `pointerdown` va en el canvas y no en window, así que tocar un botón del HUD
     no cuenta como apretar sobre la escena; el `pointerup` sí va en window, para
     que soltar afuera igual suelte. La órbita se queda con el botón derecho, el
     del medio y Shift+izquierdo (orbit.js), y acá se los deja pasar. */
  let downId = -1;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.shiftKey) return;
    // un segundo dedo es el gesto de órbita, no un trazo: se suelta
    if (downId !== -1) { downId = -1; state.pressed = false; return; }
    downId = e.pointerId;
    state.pressed = true;
  });
  const release = (e) => {
    if (e.pointerId === downId || downId === -1) { downId = -1; state.pressed = false; }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);

  const _p = { x: 0, y: 0 };

  function getPose(ndcToPlane, prevGrip) {
    if (!state.seen) return null;
    ndcToPlane(state.nx, state.ny, _p);
    const mdx = _p.x - prevGrip.x, mdy = _p.y - prevGrip.y;
    const ml = Math.hypot(mdx, mdy);
    if (ml > 0.004) {
      const tx = mdx / ml, ty = mdy / ml;
      if (tx * state.dirx + ty * state.diry < 0.5) {
        state.dirx = tx; state.diry = ty;   // giro brusco: saltar, nunca barrer el abanico
      } else {
        const a = 0.35;
        state.dirx += (tx - state.dirx) * a;
        state.diry += (ty - state.diry) * a;
        const nl = Math.hypot(state.dirx, state.diry) || 1;
        state.dirx /= nl; state.diry /= nl;
      }
    }
    return { gx: _p.x, gy: _p.y, dirx: state.dirx, diry: state.diry };
  }

  return { getPose, state };
}
