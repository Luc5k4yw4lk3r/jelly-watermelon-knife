import { FLOOR_Y, MAX_STEP_DISP, tune } from '../config.js';

/**
 * Integración de Verlet + relajación de resortes + colisiones.
 *
 * El shape matching va en el medio a propósito: con 2 o 3 iteraciones de
 * relajación la rigidez no se propaga a través de las 10 capas de la lattice y
 * la sandía se despanzurra bajo su propio peso. Ver physics/shapeMatching.js.
 */
export function createSolver(lat, shape) {
  const { N, M, pos, prev, sprA, sprB, sprRest, sprK, sprAlive } = lat;

  function step(dt, blade) {
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

    collideFloorAndBlade(blade);
  }

  function collideFloorAndBlade(bl) {
    const useBlade = bl && bl.active && bl.opacity > 0.35;
    const ax = useBlade ? bl.x0 : 0, ay = useBlade ? bl.y0 : 0;
    const ex = useBlade ? bl.x1 - bl.x0 : 0, ey = useBlade ? bl.y1 - bl.y0 : 0;
    const eLen2 = ex * ex + ey * ey || 1;
    // una hoja rápida atraviesa en vez de empujar la gelatina
    const R = useBlade && bl.speed > tune.CUT_SPEED ? tune.BLADE_R * 0.45 : tune.BLADE_R;
    const R2 = R * R;
    const pushClamp = tune.PUSH_CLAMP;
    const friction = 1 - tune.FLOOR_FRICTION;
    const bounce = tune.FLOOR_BOUNCE;

    for (let p = 0; p < N; p++) {
      const o = p * 3;

      if (useBlade) {
        // punto más cercano sobre el segmento de la hoja, en el plano XY: el
        // cuchillo es un prisma que atraviesa toda la profundidad, así que se
        // ignora Z a propósito
        const px = pos[o] - ax, py = pos[o + 1] - ay;
        let t = (px * ex + py * ey) / eLen2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const dx = px - ex * t, dy = py - ey * t;
        const d2 = dx * dx + dy * dy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1e-6;
          let push = R - d;
          if (push > pushClamp) push = pushClamp;
          pos[o]     += dx / d * push;
          pos[o + 1] += dy / d * push;
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
