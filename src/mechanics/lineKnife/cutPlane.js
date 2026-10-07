import { FLOOR_Y } from '../../config.js';

/**
 * Alto del quad barrido, medido desde el plano de apuntado.
 *
 * **No depende de dónde flota la cuchilla.** Atar el techo del corte a la altura
 * de espera parece natural y es un error: bajar esa altura por encuadre deja el
 * quad por debajo de la coronilla de la fruta, y las mitades quedan unidas por
 * un puente fino de resortes. El corte se ve perfecto y no separa nada.
 *
 * Lo que manda es dónde **puede** haber gelatina: desde bien arriba hasta pasado
 * el piso, que es lo más bajo que puede estar una partícula.
 */
export const CUT_TOP = 3.0;
export const CUT_BOTTOM = FLOOR_Y - 0.3;

/**
 * Geometría del corte vertical por la línea AB. **Puro**: números entran,
 * números salen, y por eso se testea en Node.
 *
 * El cutter proyecta las partículas a una base y corta los resortes que cruzan
 * un quad en esas dos coordenadas. Alcanza con darle **otra base**:
 *
 *   derecha      = dirección horizontal de A→B   → `pa` es distancia sobre AB
 *   arriba       = +Y del mundo                  → `pb` es altura del mundo
 *   profundidad  = derecha × arriba              → la normal del plano de corte
 *   origen       = A, a la altura del plano de apuntado
 *
 * El eje de profundidad es el que el cutter ignora, así que el corte atraviesa
 * la fruta de lado a lado por el plano vertical que contiene AB — que es
 * exactamente lo pedido. Y como el quad está acotado sobre `pa`, el corte **no**
 * es un plano infinito: más allá de A y de B, con su margen, no se toca nada.
 */
export function verticalCut(a, b, planeY, margin, basis, blade) {
  let dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return 0;
  dx /= len; dz /= len;

  basis.rx = dx;  basis.ry = 0; basis.rz = dz;
  basis.ux = 0;   basis.uy = 1; basis.uz = 0;
  // derecha × arriba, con derecha horizontal: queda horizontal y unitaria
  basis.fx = -dz; basis.fy = 0; basis.fz = dx;
  basis.tx = a.x; basis.ty = planeY; basis.tz = a.z;

  /* La hoja sintética es el filo horizontal en lo alto del recorrido, y su
     "posición anterior" el mismo filo al final: el quad barrido es el rectángulo
     completo. Se corta de una sola vez, no frame por frame, así que el resultado
     no depende de cuántos frames caigan. */
  const yt = CUT_TOP, yb = CUT_BOTTOM - planeY;
  blade.x0 = -margin;    blade.y0 = yt;
  blade.x1 = len + margin; blade.y1 = yt;
  blade.px0 = -margin;   blade.py0 = yb;
  blade.px1 = len + margin; blade.py1 = yb;
  blade.dirx = 1; blade.diry = 0;

  return len;
}
