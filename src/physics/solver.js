import { FLOOR_Y, MAX_STEP_DISP, tune } from '../config.js';

/**
 * Integración de Verlet + relajación de resortes + colisiones.
 *
 * El shape matching va en el medio a propósito: con 2 o 3 iteraciones de
 * relajación la rigidez no se propaga a través de las 10 capas de la lattice y
 * la sandía se despanzurra bajo su propio peso. Ver physics/shapeMatching.js.
 */
export function createSolver(lat, shape, basis) {
  const { N, M, pos, prev, sprA, sprB, sprRest, sprK, sprAlive } = lat;

  function step(dt, blades) {
    const dt2 = dt * dt;
    const g = tune.GRAVITY * dt2;
    const damping = tune.DAMPING;

    // --- integración de Verlet ---
    for (let p = 0; p < N; p++) {
      const o = p * 3;
      let vx = (pos[o] - prev[o]) * damping;
      let vy = (pos[o + 1] - prev[o + 1]) * damping;
      let vz = (pos[o + 2] - prev[o + 2]) * damping;
      // tope que mantiene estable la simulación después de un tajo violento
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > MAX_STEP_DISP * MAX_STEP_DISP) {
        const s = MAX_STEP_DISP / Math.sqrt(v2);
        vx *= s; vy *= s; vz *= s;
      }
      prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
      pos[o] = pos[o] + vx;
      pos[o + 1] = pos[o + 1] + vy + g;
      pos[o + 2] = pos[o + 2] + vz;
    }

    // --- relajación de resortes ---
    for (let it = 0, iter = tune.ITER; it < iter; it++) {
      // se alterna el sentido del barrido: un orden Gauss-Seidel fijo sesga la
      // solución e inyecta momento angular en el cuerpo de a poco
      const back = (it & 1) === 1;
      for (let q = 0; q < M; q++) {
        const m = back ? M - 1 - q : q;
        if (!sprAlive[m]) continue;
        const oa = sprA[m] * 3, ob = sprB[m] * 3;
        const dx = pos[ob] - pos[oa];
        const dy = pos[ob + 1] - pos[oa + 1];
        const dz = pos[ob + 2] - pos[oa + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const corr = (d - sprRest[m]) / d * 0.5 * sprK[m];
        const cx = dx * corr, cy = dy * corr, cz = dz * corr;
        pos[oa] += cx; pos[oa + 1] += cy; pos[oa + 2] += cz;
        pos[ob] -= cx; pos[ob + 1] -= cy; pos[ob + 2] -= cz;
      }
    }

    // --- rigidez global que los resortes locales no pueden dar ---
    shape.apply();
    shape.dampSpin();

    collideFloorAndBlades(blades);
  }

  // parámetros de hasta dos hojas activas, aplanados para el bucle caliente
  const bax = [0, 0], bay = [0, 0], bex = [0, 0], bey = [0, 0];
  const blen2 = [1, 1], brad2 = [0, 0], brad = [0, 0];

  function collideFloorAndBlades(blades) {
    let nb = 0;
    for (let i = 0; i < blades.length; i++) {
      const bl = blades[i];
      if (!bl || !bl.active || bl.opacity <= 0.35) continue;
      bax[nb] = bl.x0; bay[nb] = bl.y0;
      bex[nb] = bl.x1 - bl.x0; bey[nb] = bl.y1 - bl.y0;
      blen2[nb] = bex[nb] * bex[nb] + bey[nb] * bey[nb] || 1;
      // una hoja rápida atraviesa en vez de empujar la gelatina
      const R = bl.speed > tune.CUT_SPEED ? tune.BLADE_R * 0.45 : tune.BLADE_R;
      brad[nb] = R; brad2[nb] = R * R;
      nb++;
    }
    const pushClamp = tune.PUSH_CLAMP;
    const friction = 1 - tune.FLOOR_FRICTION;
    const { rx, ry, rz, ux, uy, uz, tx, ty, tz } = basis;
    const bounce = tune.FLOOR_BOUNCE;

    for (let p = 0; p < N; p++) {
      const o = p * 3;

      if (nb) {
        // punto más cercano sobre el segmento de cada hoja, proyectado al plano
        // de corte: el cuchillo es un prisma que atraviesa toda la profundidad,
        // así que el eje hacia la cámara se ignora a propósito
        const wx = pos[o] - tx, wy = pos[o + 1] - ty, wz = pos[o + 2] - tz;
        const a = wx * rx + wy * ry + wz * rz;
        const b = wx * ux + wy * uy + wz * uz;
        for (let i = 0; i < nb; i++) {
          const px = a - bax[i], py = b - bay[i];
          let t = (px * bex[i] + py * bey[i]) / blen2[i];
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const dx = px - bex[i] * t, dy = py - bey[i] * t;
          const d2 = dx * dx + dy * dy;
          if (d2 >= brad2[i]) continue;
          const d = Math.sqrt(d2) || 1e-6;
          let push = brad[i] - d;
          if (push > pushClamp) push = pushClamp;
          // el empuje vuelve al mundo sobre los ejes derecha/arriba de la cámara
          const sx = dx / d * push, sy = dy / d * push;
          pos[o]     += sx * rx + sy * ux;
          pos[o + 1] += sx * ry + sy * uy;
          pos[o + 2] += sx * rz + sy * uz;
        }
      }

      if (pos[o + 1] < FLOOR_Y) {
        pos[o + 1] = FLOOR_Y;
        const vy = prev[o + 1] - FLOOR_Y;
        prev[o + 1] = FLOOR_Y - vy * bounce;
        // fricción tangencial
        prev[o]     += (pos[o] - prev[o]) * friction;
        prev[o + 2] += (pos[o + 2] - prev[o + 2]) * friction;
      }
    }
  }

  return { step };
}
