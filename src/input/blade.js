import { BLADE_LEN, BLADE_BACK, tune } from '../config.js';

/**
 * Convierte una pose cruda (punto de agarre + dirección) en el estado de la
 * hoja: segmento actual, segmento del frame anterior, velocidad, rotación por
 * frame y opacidad.
 *
 * Toda la sutileza de "cuándo es legítimo cortar" vive acá:
 *
 *  - Al recuperar la mano se iguala el segmento anterior al actual, para que el
 *    fundido de entrada nunca produzca un tajo fantasma del largo de la pantalla.
 *  - Ante un giro brusco se salta en vez de interpolar: easing a través de 180°
 *    barrería la hoja por la sandía como un limpiaparabrisas y la picaría toda.
 *  - `rot` se reporta por frame para que main.js pueda vetar el corte mientras
 *    la hoja gira rápido.
 */
export function createBlade() {
  const blade = {
    active: false, opacity: 0,
    x0: 0, y0: 0, x1: 0, y1: BLADE_LEN,       // filo actual (XY, en el plano de corte)
    px0: 0, py0: 0, px1: 0, py1: BLADE_LEN,   // el del frame anterior
    vx: 0, vy: 0, speed: 0,
    dirx: 0, diry: 1, rot: 0,
    gx: 0, gy: 0,                              // punto de agarre (origen de la hoja)
  };

  function update(dt, pose, speedDt) {
    const gotPose = !!pose;
    const wasActive = blade.active;
    blade.active = gotPose;

    // se desvanece en vez de teletransportarse cuando se pierde la mano
    const target = gotPose ? 1 : 0;
    const rate = gotPose ? 7.5 : 4.5;
    blade.opacity += (target - blade.opacity) * Math.min(1, rate * dt);
    if (blade.opacity < 0.004) blade.opacity = 0;

    if (!gotPose) { blade.speed = 0; blade.vx = blade.vy = 0; return blade; }

    const { gx, gy, dirx: dx, diry: dy } = pose;

    // un poco más de suavizado a nivel de hoja
    const sm = Math.min(1, 26 * dt);
    blade.gx += (gx - blade.gx) * (wasActive ? sm : 1);
    blade.gy += (gy - blade.gy) * (wasActive ? sm : 1);

    const pdx = blade.dirx, pdy = blade.diry;
    if (!wasActive || dx * pdx + dy * pdy < 0.5) {
      blade.dirx = dx; blade.diry = dy;
    } else {
      const ds = Math.min(1, 16 * dt);
      blade.dirx += (dx - blade.dirx) * ds;
      blade.diry += (dy - blade.diry) * ds;
    }
    const dl = Math.hypot(blade.dirx, blade.diry) || 1;
    blade.dirx /= dl; blade.diry /= dl;
    blade.rot = wasActive
      ? Math.abs(Math.atan2(pdx * blade.diry - pdy * blade.dirx, pdx * blade.dirx + pdy * blade.diry))
      : Math.PI;

    blade.px0 = blade.x0; blade.py0 = blade.y0;
    blade.px1 = blade.x1; blade.py1 = blade.y1;

    blade.x0 = blade.gx + blade.dirx * BLADE_BACK;
    blade.y0 = blade.gy + blade.diry * BLADE_BACK;
    blade.x1 = blade.gx + blade.dirx * BLADE_LEN;
    blade.y1 = blade.gy + blade.diry * BLADE_LEN;

    if (!wasActive) {
      // recién recuperada: se mata el barrido fantasma
      blade.px0 = blade.x0; blade.py0 = blade.y0;
      blade.px1 = blade.x1; blade.py1 = blade.y1;
    }

    const mx = (blade.x0 + blade.x1) * 0.5 - (blade.px0 + blade.px1) * 0.5;
    const my = (blade.y0 + blade.y1) * 0.5 - (blade.py0 + blade.py1) * 0.5;
    /* La velocidad va contra el tiempo **real** del frame, no contra el `dt`
       que el loop recorta para que la física no explote. Si un frame tardó
       200 ms, la mano se movió en 200 ms: medirlo contra 100 ms duplica la
       velocidad y dispara cortes espurios con la mano lenta. Solo pasa en
       máquinas que van a fps bajos, que es justo donde más molesta.
       El piso evita el problema inverso: un frame muy corto daría un absurdo. */
    const sdt = Math.max(speedDt === undefined ? dt : speedDt, 1 / 200);
    blade.vx = mx / sdt; blade.vy = my / sdt;
    blade.speed = Math.hypot(blade.vx, blade.vy);
    if (blade.speed > 14) { const sc = 14 / blade.speed; blade.vx *= sc; blade.vy *= sc; }

    return blade;
  }

  /** Rápida, estable y bien visible: recién ahí el tajo cuenta como corte. */
  function shouldCut() {
    return blade.active
        && blade.opacity > 0.6
        && blade.speed > tune.CUT_SPEED
        && blade.rot < tune.MAX_CUT_ROT;
  }

  return { blade, update, shouldCut };
}
