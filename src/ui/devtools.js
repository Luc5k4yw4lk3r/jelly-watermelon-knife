/**
 * Superficie de depuración, solo con `?dev` en la URL.
 *
 * Existe porque medir cualquier cosa de esta app requería parchear el fuente,
 * buildear y revertir — tres veces en una sola sesión. Con esto los tests y la
 * consola pueden preguntar sin tocar el código, y la métrica que decide si una
 * mejora de la cara de corte sirve queda estable entre versiones.
 */
import { planarityOf } from '../physics/planarity.js';

export const DEV = new URLSearchParams(location.search).has('dev');

/**
 * Estado que el frame loop consulta cuando `?dev` está activo.
 *
 * Poder congelar la simulación es lo que permite comparar dos frames idénticos
 * salvo por una cosa. Sin eso, un pixel-diff compara escenas distintas porque la
 * gelatina nunca deja de moverse.
 */
export const devState = { paused: false, juiceVisible: null };

export function installDevtools({
  cutFaces,
  lat, topo, jelly, juice, replay, pieces,
  getBlades, getMechanic, getMechanicState, getPieces, getPhysMs, getCuts, getScore,
  cutLine, splitAt,
}) {
  if (!DEV) return;

  /**
   * Planaridad de la cara de corte: RMS de la distancia de sus vértices al plano
   * de mejor ajuste, en unidades de mundo.
   *
   * Es la métrica correcta para la silueta escalonada. La alineación de normales
   * **no** sirve: ya puntúa 0.93 porque las normales están suavizadas, mientras
   * la silueta sigue en escalera. Esto mide la amplitud del escalón, que es lo
   * que se ve. Una celda de la lattice mide ~0.18.
   *
   * Se devuelven dos números:
   *  - `rms`: sobre la malla tal como se dibuja. Es el que importa, pero incluye
   *    el bamboleo de la gelatina, así que varía entre corridas.
   *  - `restRms`: sobre las posiciones de reposo. Mide solo la escalera
   *    geométrica, sin deformación: es determinista y sirve de línea base.
   */
  function cutFacePlanarity() {
    const { visFace, visCount } = topo;
    const { faceKind, faceCorner, rest } = lat;
    const idxs = [];
    const seen = new Set();
    for (let s = 0; s < visCount; s++) {
      const f = visFace[s];
      if (faceKind[f] !== 1) continue;
      for (let v = 0; v < 4; v++) {
        const p = faceCorner[f * 4 + v];
        if (!seen.has(p)) { seen.add(p); idxs.push(p); }
      }
    }
    /* Con el recorte activo, lo que se ve es la sección y no las caras de celda:
       medir las viejas diría que no cambió nada mientras la pantalla muestra
       otra cosa. La métrica tiene que mirar lo que se dibuja. */
    const sec = cutFaces ? cutFaces.sectionRest() : null;
    if (sec && sec.length) {
      const n = sec.length / 3;
      const all = Array.from({ length: n }, (_, i) => i);
      return { points: n, rms: planarityOf(cutFaces.renderPositions(), all), restRms: planarityOf(sec, all) };
    }

    return {
      points: idxs.length,
      rms: planarityOf(jelly.renderPositions(), idxs),
      restRms: planarityOf(rest, idxs),
    };
  }

  window.__dev = {
    pause() { devState.paused = true; },
    resume() { devState.paused = false; },
    /** Fuerza la visibilidad del pool de jugo; null devuelve el control al juego. */
    setJuiceVisible(v) { devState.juiceVisible = v; },
    get pieces() { return getPieces(); },
    /* Cuántas veces el cutter cortó algo, y cuántos resortes en total. Es la
       medida precisa del contrato "lento empuja, rápido corta": que la sandía
       llegue a separarse en dos depende además de cuántos frames caigan, lo que
       hace flaky la aserción sobre el contador de pedazos. */
    get cuts() { return getCuts(); },
    get replay() { return replay ? { total: replay.total, done: replay.done, at: replay.at } : null; },
    /** Estado de las hojas: lo primero que hay que mirar si un tajo no corta.
        Depende de la mecánica activa, y hay mecánicas que no tienen hojas. */
    get blades() {
      return getBlades().map((b) => ({
        active: b.active,
        opacity: +b.opacity.toFixed(2),
        speed: +b.speed.toFixed(2),
        rot: +b.rot.toFixed(3),
      }));
    },
    get mechanic() { return getMechanic(); },
    /** Lo que la mecánica activa quiera exponer; null si no expone nada. */
    get mechanicState() { return getMechanicState(); },
    /** Tamaños de las componentes conexas vivas, de mayor a menor.
        El contador de pedazos ignora las de menos de 10 partículas; esto muestra
        todo, que es lo que hace falta cuando un corte se ve y no separa. */
    get components() {
      const out = [];
      for (let L = 0; L < pieces.nLabels; L++) out.push(pieces.sizeOf(L));
      return out.sort((a, b) => b - a);
    },
    /** Ids estables de las piezas vivas, para seguir quién salió de quién. */
    get pieceIds() {
      const out = [];
      for (let L = 0; L < pieces.nLabels; L++) out.push(pieces.idOfLabel(L));
      return out;
    },
    /** Puntaje: estadísticas de la sesión y el último corte medido. */
    get score() { return getScore(); },
    /** Corta por una línea de mundo, sin gesto. La mecánica que no sepa, ignora. */
    cutLine,
    /** Reparto que daría una línea **ahora mismo**, sin cortar. */
    splitAt,
    get juiceCount() { return juice.count; },
    get physMs() { return +getPhysMs().toFixed(2); },
    get visibleFaces() { return topo.visCount; },
    cutFacePlanarity,
    /** Tamaño de la cara de corte: si es cero, no se está dibujando nada. */
    get cutFaceStats() { return cutFaces ? cutFaces.stats : null; },
  };
}
