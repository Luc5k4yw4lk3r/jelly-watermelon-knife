/**
 * Planaridad de una nube de puntos: el RMS de la distancia al plano de mejor
 * ajuste.
 *
 * Es la métrica que decide si la cara de corte mejoró. La alineación de normales
 * parecía la natural y resultó inútil —ya daba 0.926 mientras la silueta seguía
 * en escalera—, porque las normales están suavizadas y la silueta es geometría.
 *
 * Vive acá, y no dentro de las devtools, para poder medir en Node en segundos:
 * una métrica que solo corre en el navegador se mide poco.
 *
 * Módulo **puro**: números entran, números salen.
 */

/**
 * @param {ArrayLike<number>} positions  xyz por partícula, plano
 * @param {number[]} idxs                qué partículas entran en la nube
 * @returns {number} RMS a 4 decimales; 0 si hay menos de 4 puntos
 */
export function planarityOf(positions, idxs) {
  const n = idxs.length;
  if (n < 4) return 0;
  let cx = 0, cy = 0, cz = 0;
  for (const p of idxs) { cx += positions[p*3]; cy += positions[p*3+1]; cz += positions[p*3+2]; }
  cx /= n; cy /= n; cz /= n;

  let xx=0, xy=0, xz=0, yy=0, yz=0, zz=0;
  for (const p of idxs) {
    const dx = positions[p*3]-cx, dy = positions[p*3+1]-cy, dz = positions[p*3+2]-cz;
    xx+=dx*dx; xy+=dx*dy; xz+=dx*dz; yy+=dy*dy; yz+=dy*dz; zz+=dz*dz;
  }
  // normal del plano de mejor ajuste: autovector menor de la covarianza. Se
  // itera sobre (traza*I - C), que invierte el orden espectral y deja el menor
  // como dominante
  const tr = xx + yy + zz;
  const m = [tr-xx, -xy, -xz, -xy, tr-yy, -yz, -xz, -yz, tr-zz];
  let vx = 1, vy = 1, vz = 1;
  for (let it = 0; it < 48; it++) {
    const nx = m[0]*vx + m[1]*vy + m[2]*vz;
    const ny = m[3]*vx + m[4]*vy + m[5]*vz;
    const nz = m[6]*vx + m[7]*vy + m[8]*vz;
    const l = Math.hypot(nx, ny, nz) || 1;
    vx = nx/l; vy = ny/l; vz = nz/l;
  }
  let sum = 0;
  for (const p of idxs) {
    const d = (positions[p*3]-cx)*vx + (positions[p*3+1]-cy)*vy + (positions[p*3+2]-cz)*vz;
    sum += d*d;
  }
  return +Math.sqrt(sum / n).toFixed(4);
}
