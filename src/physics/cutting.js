import { tune } from '../config.js';

/**
 * Corte por topología: se eliminan los resortes cuyo segmento cruza el área que
 * barrió la hoja entre el frame anterior y el actual.
 *
 * Este módulo es **puro** respecto del resto de la app: corta resortes y
 * devuelve qué pasó. Reconstruir la topología, lanzar el jugo, sonar el squish y
 * actualizar el HUD son decisiones de main.js, no de acá.
 *
 * `cut()` acepta opciones por llamada para que una mecánica pueda cortar por un
 * plano que no es el de la cámara. Los defaults son los de siempre, así que el
 * camino del cuchillo que sigue la mano no cambia:
 *
 *   basis       base en la que se proyecta y se barre el quad
 *   kerf        ranura lateral máxima (ver `clampSweep`)
 *   crossDepth  exige que el resorte **cruce** el plano, no solo que caiga adentro
 *   juiceBasis  base que decide de qué lado del corte salpica el jugo
 *
 * Sobre `crossDepth`: el predicado de siempre es "el resorte cae dentro del área
 * barrida", y el eje de profundidad se ignora porque la hoja es un prisma que
 * atraviesa toda la escena. Eso es correcto para un barrido, que en pantalla es
 * una astilla fina. Para un **plano** no alcanza: el quad cubre toda la fruta en
 * las dos coordenadas que quedan, así que "caer adentro" lo cumple cada resorte
 * y se desintegraría todo en vez de partirse en dos.
 *
 * Se probó además darle **grosor** al plano, cortando todo lo que tocara una
 * losa de ±0.04 a su alrededor. Medido, es peor: el mismo tajo pasa de 1030 a
 * 1704 resortes cortados y empieza a soltar partículas sueltas, porque también
 * se lleva los resortes que corren paralelos al plano. El cambio de signo es el
 * predicado correcto.
 */
const NO_OPTS = {};

export function createCutter(lat, basis) {
  const { N, M, pos, sprA, sprB, sprAlive, maxSprLen } = lat;

  /* Las partículas se proyectan al plano de corte (derecha/arriba de la cámara)
     y a su profundidad. Trabajar en esta base, y no en XY del mundo, es lo que
     permite orbitar sin que el corte deje de coincidir con lo que se ve. */
  const pa = new Float32Array(N);   // sobre el eje "derecha"
  const pb = new Float32Array(N);   // sobre el eje "arriba"
  const pd = new Float32Array(N);   // hacia la cámara
  const pc = new Float32Array(N);   // profundidad en la base del corte

  const quad = new Float64Array(8); // baseAnterior, puntaAnterior, puntaActual, baseActual
  const inBox = new Uint8Array(N);
  const spawnPoints = new Float32Array(16 * 3);

  function segSeg(p0x, p0y, p1x, p1y, q0x, q0y, q1x, q1y) {
    const rx = p1x - p0x, ry = p1y - p0y;
    const sx = q1x - q0x, sy = q1y - q0y;
    const den = rx * sy - ry * sx;
    if (den > -1e-12 && den < 1e-12) return false;
    const dx = q0x - p0x, dy = q0y - p0y;
    const t = (dx * sy - dy * sx) / den;
    if (t < 0 || t > 1) return false;
    const u = (dx * ry - dy * rx) / den;
    return u >= 0 && u <= 1;
  }
  function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const pos_ = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(neg && pos_);
  }
  function pointInQuad(px, py) {
    return pointInTri(px, py, quad[0], quad[1], quad[2], quad[3], quad[4], quad[5])
        || pointInTri(px, py, quad[0], quad[1], quad[4], quad[5], quad[6], quad[7]);
  }
  function segCrossesQuad(ax, ay, bx, by) {
    for (let e = 0; e < 4; e++) {
      const i0 = e * 2, i1 = ((e + 1) & 3) * 2;
      if (segSeg(ax, ay, bx, by, quad[i0], quad[i0 + 1], quad[i1], quad[i1 + 1])) return true;
    }
    return pointInQuad(ax, ay);
  }

  /* Una hoja que se mueve de costado barre un rectángulo tan ancho como ella es
     larga; cortar todos los resortes de adentro excavaría una tajada entera en
     vez de rebanar. Se conserva todo el barrido sobre el eje de la hoja (que es
     el corte de verdad) y se acota la componente lateral a un kerf. */
  const _sw = [0, 0];
  function clampSweep(cx, cy, px, py, dx, dy, kerf) {
    const ox = px - cx, oy = py - cy;
    const par = ox * dx + oy * dy;
    let qx = ox - par * dx, qy = oy - par * dy;
    const ql = Math.hypot(qx, qy);
    if (ql > kerf) { const sc = kerf / ql; qx *= sc; qy *= sc; }
    _sw[0] = cx + par * dx + qx;
    _sw[1] = cy + par * dy + qy;
  }

  /**
   * @returns {{severed:number, spawns:number, spawnPoints:Float32Array, strength:number}}
   */
  function cut(blade, opts = NO_OPTS) {
    const cb = opts.basis || basis;
    const jb = opts.juiceBasis || basis;
    const kerf = opts.kerf === undefined ? tune.MAX_KERF : opts.kerf;
    const crossDepth = opts.crossDepth === true;

    const dx = blade.dirx, dy = blade.diry;
    clampSweep(blade.x0, blade.y0, blade.px0, blade.py0, dx, dy, kerf);
    quad[0] = _sw[0]; quad[1] = _sw[1];
    clampSweep(blade.x1, blade.y1, blade.px1, blade.py1, dx, dy, kerf);
    quad[2] = _sw[0]; quad[3] = _sw[1];
    quad[4] = blade.x1; quad[5] = blade.y1;
    quad[6] = blade.x0; quad[7] = blade.y0;

    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let e = 0; e < 4; e++) {
      const x = quad[e * 2], y = quad[e * 2 + 1];
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    const pad = maxSprLen + 0.001;
    minx -= pad; maxx += pad; miny -= pad; maxy += pad;

    // proyección a la base de cámara + broadphase: un resorte solo puede
    // alcanzar el área barrida si alguno de sus extremos cae en el bbox del quad
    // expandido por el resorte más largo
    const { rx, ry, rz, ux, uy, uz, tx, ty, tz } = cb;
    const cfx = cb.fx, cfy = cb.fy, cfz = cb.fz;
    /* La profundidad se mide siempre contra la base del **jugo**, no contra la
       del corte: es la que dice qué lado mira a la cámara. Cuando las dos son la
       misma —el caso de siempre— sale exactamente el mismo número. */
    const { fx, fy, fz, tx: jx, ty: jy, tz: jz } = jb;
    for (let p = 0; p < N; p++) {
      const o = p * 3;
      const dx = pos[o] - tx, dy = pos[o + 1] - ty, dz = pos[o + 2] - tz;
      const a = dx * rx + dy * ry + dz * rz;
      const b = dx * ux + dy * uy + dz * uz;
      pa[p] = a; pb[p] = b;
      if (crossDepth) pc[p] = dx * cfx + dy * cfy + dz * cfz;
      pd[p] = -((pos[o] - jx) * fx + (pos[o + 1] - jy) * fy + (pos[o + 2] - jz) * fz);
      inBox[p] = (a >= minx && a <= maxx && b >= miny && b <= maxy) ? 1 : 0;
    }

    let severed = 0, spawns = 0;
    for (let m = 0; m < M; m++) {
      if (!sprAlive[m]) continue;
      const a = sprA[m], b = sprB[m];
      if (!inBox[a] && !inBox[b]) continue;
      // un corte por plano solo se lleva lo que lo cruza; ver `crossDepth`
      if (crossDepth && (pc[a] < 0) === (pc[b] < 0)) continue;
      if (!segCrossesQuad(pa[a], pb[a], pa[b], pb[b])) continue;
      sprAlive[m] = 0;
      severed++;
      // solo salpica desde el lado del corte que mira a la cámara: las gotas que
      // nacen dentro de la sandía quedan simplemente escondidas detrás
      const depth = (pd[a] + pd[b]) * 0.5;
      if (spawns < 14 && depth > 0.25 && (severed % 7) === 0) {
        const oa = a * 3, ob = b * 3, s = spawns * 3;
        // el punto medio, corrido 0.12 hacia la cámara para que no nazca tapado
        spawnPoints[s]     = (pos[oa] + pos[ob]) * 0.5 - fx * 0.12;
        spawnPoints[s + 1] = (pos[oa + 1] + pos[ob + 1]) * 0.5 - fy * 0.12;
        spawnPoints[s + 2] = (pos[oa + 2] + pos[ob + 2]) * 0.5 - fz * 0.12;
        spawns++;
      }
    }

    return { severed, spawns, spawnPoints, strength: Math.min(1, severed / 90) };
  }

  return { cut };
}
