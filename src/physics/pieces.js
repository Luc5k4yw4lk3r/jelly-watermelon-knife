/**
 * Identidad de los pedazos, que la simulación por sí sola no tiene.
 *
 * `shapeMatching` ya calcula componentes conexas, pero sus slots se renumeran de
 * cero en cada reconstrucción —el orden depende de qué resortes quedaron vivos—,
 * así que el slot 0 de antes del corte no tiene nada que ver con el slot 0 de
 * después. Y manda al centinela −1 todo lo más chico que `SM_MIN`, de modo que
 * las migas no se distinguen entre sí.
 *
 * Acá se lleva un union-find propio con etiquetas densas para **todas** las
 * componentes, y encima un id estable: una componente hereda el id de la vieja a
 * la que pertenecía la mayoría de sus partículas. Si una vieja queda repartida en
 * dos componentes, se partió: los hijos reciben ids nuevos y se emite el evento.
 *
 * Sin esto no se puede decir «el pedazo 3 se partió en el 7 y el 8», que es lo
 * que necesita el puntaje para saber **de qué** es mitad cada mitad.
 */
export function createPieceTracker(lat) {
  const { N, M, sprA, sprB, sprAlive } = lat;

  const parent = new Int32Array(N);      // union-find
  const label = new Int32Array(N);       // componente densa, 0..nLabels-1
  const rootLabel = new Int32Array(N);
  const idOf = new Int32Array(N);        // id estable por partícula
  const prevId = new Int32Array(N);

  /* Por componente nueva: id heredado y tamaño. Se dimensionan con N porque en
     el peor caso cada partícula es su propia componente. */
  const labelId = new Int32Array(N);
  const labelSize = new Int32Array(N);
  const bestVotes = new Int32Array(N);
  /** Clave compuesta `componente * ID_BASE + idViejo` para contar votos. */
  const ID_BASE = 1 << 20;
  const votes = new Map();
  const claims = new Map();

  let nLabels = 1;
  let nextId = 1;
  const events = [];

  function find(x) {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }

  /**
   * Recalcula las componentes y devuelve los splits que ocurrieron.
   *
   * @returns {Array<{parent:number, children:number[]}>} reusado entre llamadas
   */
  function rebuild() {
    prevId.set(idOf);

    for (let p = 0; p < N; p++) parent[p] = p;
    for (let m = 0; m < M; m++) {
      if (!sprAlive[m]) continue;
      const a = find(sprA[m]), b = find(sprB[m]);
      if (a !== b) parent[a] = b;
    }

    // etiquetas densas
    rootLabel.fill(-1);
    nLabels = 0;
    for (let p = 0; p < N; p++) {
      const r = find(p);
      if (rootLabel[r] < 0) rootLabel[r] = nLabels++;
      label[p] = rootLabel[r];
    }

    /* Cada componente hereda el id que traía la mayoría de sus partículas.
       Un solo barrido: se cuentan los votos en un mapa con clave compuesta, en
       vez de recorrer N partículas por cada componente —que con la sandía hecha
       migas serían dos millones de pasos. Esto corre en un corte, no por frame,
       así que el mapa no molesta. */
    labelSize.fill(0, 0, nLabels);
    for (let L = 0; L < nLabels; L++) { labelId[L] = -1; bestVotes[L] = 0; }

    votes.clear();
    for (let p = 0; p < N; p++) {
      const L = label[p];
      labelSize[L]++;
      const key = L * ID_BASE + prevId[p];
      votes.set(key, (votes.get(key) || 0) + 1);
    }
    for (const [key, n] of votes) {
      const L = Math.floor(key / ID_BASE);
      if (n > bestVotes[L]) { bestVotes[L] = n; labelId[L] = key - L * ID_BASE; }
    }

    claims.clear();
    for (let L = 0; L < nLabels; L++) {
      const id = labelId[L];
      if (id >= 0) claims.set(id, (claims.get(id) || 0) + 1);
    }

    /* Un id reclamado por dos componentes es un pedazo que se partió: todos sus
       hijos estrenan id, así «de qué pieza era mitad» no queda ambiguo. */
    events.length = 0;
    for (let L = 0; L < nLabels; L++) {
      const inherited = labelId[L];
      if (inherited < 0 || claims.get(inherited) <= 1) continue;
      let ev = events.find((e) => e.parent === inherited);
      if (!ev) { ev = { parent: inherited, children: [], labels: [] }; events.push(ev); }
      labelId[L] = nextId++;
      ev.children.push(labelId[L]);
      ev.labels.push(L);
    }

    for (let p = 0; p < N; p++) idOf[p] = labelId[label[p]];
    return events;
  }

  /** Arranca de cero: una sola pieza con el id 1. */
  function reset() {
    idOf.fill(1);
    prevId.fill(1);
    nextId = 2;
    events.length = 0;
    rebuild();
  }

  idOf.fill(1);
  prevId.fill(1);
  nextId = 2;

  return {
    rebuild, reset,
    label, idOf,
    get nLabels() { return nLabels; },
    /** Tamaño en partículas de cada componente, por etiqueta densa. */
    sizeOf: (L) => labelSize[L],
    /** Id estable de una componente densa. */
    idOfLabel: (L) => labelId[L],
  };
}
