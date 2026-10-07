import { MAX_COMP } from '../config.js';

/**
 * Abre las dos mitades de un corte empujándolas en sentidos opuestos.
 *
 * **La velocidad es implícita en `pos - prev`**, así que para agregar velocidad
 * se le resta a `prev` y `pos` no se toca. Es el mismo idioma que usan
 * `dampSpin` y la fricción del piso; mover `pos` abriría un hueco geométrico
 * instantáneo, que no es lo que se quiere.
 *
 * El lado de cada pedazo sale del signo de su **centroide** contra el plano, no
 * del de cada partícula: por partícula, las que están justo sobre el plano se
 * irían para cualquier lado.
 *
 * **El número es más chico de lo que parece.** La velocidad se multiplica por
 * `tune.DAMPING` en cada paso, así que un empujón de una sola vez recorre
 * `impulso / (1 - DAMPING)` antes de frenar: con 0.9918 eso es **122 veces** el
 * impulso. Un valor que suena diminuto manda las mitades fuera de cuadro.
 *
 * Hay que llamarla **después** de `shape.rebuild()`, o `compOf` todavía tiene
 * los slots de antes del corte. Las migas (componentes más chicas que `SM_MIN`)
 * comparten el centinela −1 y no son direccionables de a una: se quedan quietas.
 */
export function createPusher(lat, shape) {
  const { N, pos, prev } = lat;
  const sum = new Float64Array(MAX_COMP * 3);
  const cnt = new Int32Array(MAX_COMP);
  const side = new Int8Array(MAX_COMP);

  function pushApart(px, py, pz, nx, ny, nz, strength) {
    if (!(strength > 0)) return 0;
    sum.fill(0); cnt.fill(0);
    const compOf = shape.compOf;

    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p * 3, s = c * 3;
      sum[s] += pos[o]; sum[s + 1] += pos[o + 1]; sum[s + 2] += pos[o + 2];
      cnt[c]++;
    }

    let pushed = 0;
    for (let c = 0; c < MAX_COMP; c++) {
      if (!cnt[c]) { side[c] = 0; continue; }
      const s = c * 3, k = 1 / cnt[c];
      const d = (sum[s] * k - px) * nx + (sum[s + 1] * k - py) * ny + (sum[s + 2] * k - pz) * nz;
      side[c] = d > 0 ? 1 : (d < 0 ? -1 : 0);
      if (side[c]) pushed++;
    }

    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const s = side[c];
      if (!s) continue;
      const o = p * 3, k = strength * s;
      prev[o]     -= nx * k;
      prev[o + 1] -= ny * k;
      prev[o + 2] -= nz * k;
    }
    return pushed;
  }

  return { pushApart };
}
