/**
 * Qué celdas siguen enteras y qué caras quedan a la vista.
 *
 * Una celda muere si pierde cualquiera de sus 12 aristas estructurales, así que
 * el corte se lleva la capa de celdas que atraviesa. Las caras de las celdas
 * vecinas que quedan sin par pasan a ser visibles: eso es lo que expone la pulpa
 * roja del interior sin tener que generar geometría nueva.
 *
 * Las caras visibles se empaquetan desde el slot 0 para que el render solo tenga
 * que subir ese prefijo del buffer cada frame.
 */
export function createTopology(lat) {
  const { NCELL, NFACE, cellEdges, faceCell, faceNbCell, sprAlive } = lat;

  const cellSolid = new Uint8Array(NCELL);
  const visFace = new Int32Array(NFACE);

  const topo = { cellSolid, visFace, visCount: 0, rebuild };

  function rebuild() {
    for (let c = 0; c < NCELL; c++) {
      const base = c * 12;
      let ok = 1;
      for (let e = 0; e < 12; e++) {
        const s = cellEdges[base + e];
        if (s < 0 || !sprAlive[s]) { ok = 0; break; }
      }
      cellSolid[c] = ok;
    }

    let n = 0;
    for (let f = 0; f < NFACE; f++) {
      if (!cellSolid[faceCell[f]]) continue;
      const nb = faceNbCell[f];
      if (nb >= 0 && cellSolid[nb]) continue;
      visFace[n++] = f;
    }
    topo.visCount = n;
    return n;
  }

  return topo;
}
