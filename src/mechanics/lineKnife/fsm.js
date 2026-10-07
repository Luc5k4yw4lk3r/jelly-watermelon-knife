import { tune, FLOOR_Y } from '../../config.js';

/**
 * Máquina de estados de la cuchilla. **Pura**: sin DOM, sin Three, sin cutter.
 *
 *   IDLE → AIMING → STRIKING → RETRACTING → IDLE
 *            └──────────────────────────────→ IDLE   (Esc, mano perdida, línea corta)
 *
 * Separarla de la malla y del corte es lo que la hace testeable en Node, igual
 * que `handPose`. Las duraciones salen de `tune`, así que un test las fija
 * escribiendo ahí.
 */
export const IDLE = 'idle';
export const AIMING = 'aiming';
export const STRIKING = 'striking';
export const RETRACTING = 'retracting';

/** Cuánto pasa la hoja por debajo del piso: tiene que atravesarlo. */
const UNDER_FLOOR = 0.45;
const END_Y = FLOOR_Y - UNDER_FLOOR;

const easeIn = (u) => u * u;                      // golpe: arranca suave, pega abajo
const easeOut = (u) => 1 - (1 - u) * (1 - u);     // retirada: frena al llegar

export function createLineKnifeFsm() {
  let state = IDLE;
  let t = 0;                  // ms dentro del estado actual
  let pending = false;        // corte encolado; a lo sumo uno
  let needRelease = false;    // no abrir un trazo con el botón ya apretado
  let hoverY = 0, endY = 0, centerY = 0;
  let align = 0;

  const out = {
    state: IDLE,
    ax: 0, az: 0, bx: 0, bz: 0,
    len: 0,
    bladeY: 0,
    align: 0,
    cut: false,
  };

  /** Al entrar a la mecánica: nada en curso, y el botón tiene que soltarse. */
  function enter(pressed) {
    state = IDLE; t = 0; pending = false; align = 0;
    out.len = 0; out.cut = false;
    needRelease = !!pressed;
  }

  const length = () => Math.hypot(out.bx - out.ax, out.bz - out.az);

  /**
   * @param {number} dtMs
   * @param {{pressed:boolean, x:number, z:number, lost:boolean, cancel:boolean,
   *          planeY:number, centerY:number, canCut:boolean}} input
   */
  function update(dtMs, input) {
    out.cut = false;
    hoverY = input.planeY + tune.HOVER_H;
    endY = END_Y;

    if (needRelease) {
      if (!input.pressed) needRelease = false;
    }

    switch (state) {
      case IDLE:
        out.bladeY = hoverY;
        align += (0 - align) * Math.min(1, dtMs / Math.max(1, tune.RETRACT_MS));
        out.ax = out.bx = input.x;
        out.az = out.bz = input.z;
        if (input.pressed && !needRelease && !input.lost) {
          state = AIMING; t = 0;
          out.ax = out.bx = input.x;
          out.az = out.bz = input.z;
        }
        break;

      case AIMING: {
        out.bladeY = hoverY;
        if (input.cancel || input.lost) { state = IDLE; t = 0; break; }
        out.bx = input.x; out.bz = input.z;
        t += dtMs;
        align = Math.min(1, t / Math.max(1, tune.ALIGN_MS));
        if (!input.pressed) {
          if (length() > tune.MIN_CUT_LEN) {
            state = STRIKING; t = 0;
            pending = true;
            centerY = input.centerY;
          } else {
            state = IDLE; t = 0;
          }
        }
        break;
      }

      case STRIKING: {
        t += dtMs;
        const u = Math.min(1, t / Math.max(1, tune.STRIKE_MS));
        const prevY = out.bladeY;
        out.bladeY = hoverY + (endY - hoverY) * easeIn(u);
        align = 1;
        /* El corte se dispara **al cruzar** el centro de la pieza, no al estar
           cerca: con un frame largo la hoja pasa de arriba de la fruta a abajo
           del piso de una sola vez, y una prueba por cercanía no dispararía
           nunca. El `u >= 1` de abajo es la red para un centro fuera del
           recorrido. */
        if (pending && prevY > centerY && out.bladeY <= centerY) {
          out.cut = input.canCut;
          pending = false;
        }
        if (u >= 1) {
          if (pending) { out.cut = input.canCut; pending = false; }
          state = RETRACTING; t = 0;
        }
        break;
      }

      case RETRACTING: {
        t += dtMs;
        const u = Math.min(1, t / Math.max(1, tune.RETRACT_MS));
        out.bladeY = endY + (hoverY - endY) * easeOut(u);
        align = 1 - u;
        if (u >= 1) { state = IDLE; t = 0; out.len = 0; }
        break;
      }
    }

    out.len = state === IDLE ? 0 : length();
    out.state = state;
    out.align = align;
    return out;
  }

  return { enter, update, get state() { return state; } };
}
