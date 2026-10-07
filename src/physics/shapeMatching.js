import { MAX_COMP, SM_MIN, tune } from '../config.js';

/**
 * Componentes conexas + shape matching (Müller et al.).
 *
 * La relajación de resortes sola no propaga rigidez a través de las 10 capas de
 * la lattice en dos o tres iteraciones, así que la sandía se despanzurra bajo su
 * propio peso. El shape matching tira de cada pedazo hacia su propia forma de
 * reposo rotada, en O(N): la gelatina conserva su silueta, sigue temblando, y
 * cada pedazo que se desprende obtiene automáticamente su propia forma objetivo.
 */
export function createShapeMatcher(lat) {
  const { N, M, pos, prev, rest, sprA, sprB, sprAlive } = lat;

  const ufParent = new Int32Array(N);
  function ufFind(x) { while (ufParent[x] !== x) { ufParent[x] = ufParent[ufParent[x]]; x = ufParent[x]; } return x; }
  const compSize = new Int32Array(N);
  const compSlot = new Int32Array(N);
  const compOf   = new Int32Array(N);

  let nComp = 0;
  const compCount  = new Int32Array(MAX_COMP);
  const compRestC  = new Float64Array(MAX_COMP * 3);
  const compCurC   = new Float64Array(MAX_COMP * 3);
  const compAqqInv = new Float64Array(MAX_COMP * 9);
  const compApq    = new Float64Array(MAX_COMP * 9);
  const compT      = new Float64Array(MAX_COMP * 9);
  const compOk     = new Uint8Array(MAX_COMP);
  const _R = new Float64Array(9), _A = new Float64Array(9), _T = new Float64Array(9);

  function det3(m, o) {
    return m[o]     * (m[o+4] * m[o+8] - m[o+5] * m[o+7])
         - m[o+1]   * (m[o+3] * m[o+8] - m[o+5] * m[o+6])
         + m[o+2]   * (m[o+3] * m[o+7] - m[o+4] * m[o+6]);
  }
  function inv3(m, o, out, oo) {
    const d = det3(m, o);
    if (d > -1e-12 && d < 1e-12) return false;
    const id = 1 / d;
    out[oo]   =  (m[o+4]*m[o+8] - m[o+5]*m[o+7]) * id;
    out[oo+1] = -(m[o+1]*m[o+8] - m[o+2]*m[o+7]) * id;
    out[oo+2] =  (m[o+1]*m[o+5] - m[o+2]*m[o+4]) * id;
    out[oo+3] = -(m[o+3]*m[o+8] - m[o+5]*m[o+6]) * id;
    out[oo+4] =  (m[o]  *m[o+8] - m[o+2]*m[o+6]) * id;
    out[oo+5] = -(m[o]  *m[o+5] - m[o+2]*m[o+3]) * id;
    out[oo+6] =  (m[o+3]*m[o+7] - m[o+4]*m[o+6]) * id;
    out[oo+7] = -(m[o]  *m[o+7] - m[o+1]*m[o+6]) * id;
    out[oo+8] =  (m[o]  *m[o+4] - m[o+1]*m[o+3]) * id;
    return true;
  }
  function mul3(a, ao, b, bo, out) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      out[r*3+c] = a[ao+r*3] * b[bo+c] + a[ao+r*3+1] * b[bo+3+c] + a[ao+r*3+2] * b[bo+6+c];
    }
  }
  /* Polar decomposition by Newton iteration: R <- (R + R^-T) / 2.
     Apq has magnitude ~N, and the iteration only halves the scale each round, so
     it MUST be normalized first or 8 rounds leave a ~1.7x scale baked into R —
     which blows the jelly up and spins it. */
  function polar(src, so, out) {
    let f = 0;
    for (let i = 0; i < 9; i++) { const v = src[so + i]; f += v * v; }
    f = Math.sqrt(f / 3);
    if (!(f > 1e-12)) return false;
    const inv = 1 / f;
    for (let i = 0; i < 9; i++) out[i] = src[so + i] * inv;
    for (let it = 0; it < 12; it++) {
      if (!inv3(out, 0, _T, 0)) return false;
      let maxd = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const v = 0.5 * (out[r*3+c] + _T[c*3+r]);
        const d = Math.abs(v - out[r*3+c]);
        if (d > maxd) maxd = d;
        _A[r*3+c] = v;
      }
      for (let i = 0; i < 9; i++) out[i] = _A[i];
      if (maxd < 1e-7) break;
    }
    return det3(out, 0) > 0;
  }

  function rebuild() {
    for (let p = 0; p < N; p++) ufParent[p] = p;
    for (let m = 0; m < M; m++) {
      if (!sprAlive[m]) continue;
      const ra = ufFind(sprA[m]), rb = ufFind(sprB[m]);
      if (ra !== rb) ufParent[ra] = rb;
    }
    compSize.fill(0);
    for (let p = 0; p < N; p++) compSize[ufFind(p)]++;

    compSlot.fill(-1);
    nComp = 0;
    let pieces = 0;
    for (let p = 0; p < N; p++) {
      if (compSize[p] >= 10) pieces++;
      if (compSize[p] >= SM_MIN && nComp < MAX_COMP) compSlot[p] = nComp++;
    }

    compCount.fill(0, 0, nComp);
    compRestC.fill(0, 0, nComp * 3);
    compApq.fill(0, 0, nComp * 9);
    for (let p = 0; p < N; p++) {
      const c = compSlot[ufFind(p)];
      compOf[p] = c;
      if (c < 0) continue;
      compCount[c]++;
      compRestC[c*3]   += rest[p*3];
      compRestC[c*3+1] += rest[p*3+1];
      compRestC[c*3+2] += rest[p*3+2];
    }
    for (let c = 0; c < nComp; c++) {
      const n = compCount[c];
      compRestC[c*3] /= n; compRestC[c*3+1] /= n; compRestC[c*3+2] /= n;
    }

    // Aqq = sum q q^T  (constant per piece) — its inverse feeds the linear term
    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3, m = c*9;
      const qx = rest[o] - compRestC[b], qy = rest[o+1] - compRestC[b+1], qz = rest[o+2] - compRestC[b+2];
      compApq[m]   += qx*qx; compApq[m+1] += qx*qy; compApq[m+2] += qx*qz;
      compApq[m+3] += qy*qx; compApq[m+4] += qy*qy; compApq[m+5] += qy*qz;
      compApq[m+6] += qz*qx; compApq[m+7] += qz*qy; compApq[m+8] += qz*qz;
    }
    for (let c = 0; c < nComp; c++) compOk[c] = inv3(compApq, c*9, compAqqInv, c*9) ? 1 : 0;

    return Math.max(1, pieces);
  }

  /* Removes rigid-body spin that the solver leaks in, without touching the
     local jiggle: solve w = I^-1 L per piece and bleed a fraction of w off. */
  const compL = new Float64Array(MAX_COMP * 3);
  const compI = new Float64Array(MAX_COMP * 9);
  const compW = new Float64Array(MAX_COMP * 3);

  function dampSpin() {
    if (!nComp || tune.SM_SPIN_DAMP <= 0) return;
    compL.fill(0, 0, nComp * 3);
    compI.fill(0, 0, nComp * 9);
    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3, m = c*9;
      const rx = pos[o] - compCurC[b], ry = pos[o+1] - compCurC[b+1], rz = pos[o+2] - compCurC[b+2];
      const vx = pos[o] - prev[o], vy = pos[o+1] - prev[o+1], vz = pos[o+2] - prev[o+2];
      compL[b]   += ry*vz - rz*vy;
      compL[b+1] += rz*vx - rx*vz;
      compL[b+2] += rx*vy - ry*vx;
      const r2 = rx*rx + ry*ry + rz*rz;
      compI[m]   += r2 - rx*rx; compI[m+1] += -rx*ry;    compI[m+2] += -rx*rz;
      compI[m+3] += -ry*rx;     compI[m+4] += r2 - ry*ry; compI[m+5] += -ry*rz;
      compI[m+6] += -rz*rx;     compI[m+7] += -rz*ry;    compI[m+8] += r2 - rz*rz;
    }
    for (let c = 0; c < nComp; c++) {
      const m = c*9, b = c*3;
      if (!inv3(compI, m, _T, 0)) { compW[b] = compW[b+1] = compW[b+2] = 0; continue; }
      compW[b]   = _T[0]*compL[b] + _T[1]*compL[b+1] + _T[2]*compL[b+2];
      compW[b+1] = _T[3]*compL[b] + _T[4]*compL[b+1] + _T[5]*compL[b+2];
      compW[b+2] = _T[6]*compL[b] + _T[7]*compL[b+1] + _T[8]*compL[b+2];
    }
    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3;
      const rx = pos[o] - compCurC[b], ry = pos[o+1] - compCurC[b+1], rz = pos[o+2] - compCurC[b+2];
      const wx = compW[b], wy = compW[b+1], wz = compW[b+2];
      prev[o]   += (wy*rz - wz*ry) * tune.SM_SPIN_DAMP;
      prev[o+1] += (wz*rx - wx*rz) * tune.SM_SPIN_DAMP;
      prev[o+2] += (wx*ry - wy*rx) * tune.SM_SPIN_DAMP;
    }
  }

  function apply() {
    if (!nComp) return;

    compCurC.fill(0, 0, nComp * 3);
    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3;
      compCurC[b] += pos[o]; compCurC[b+1] += pos[o+1]; compCurC[b+2] += pos[o+2];
    }
    for (let c = 0; c < nComp; c++) {
      const n = compCount[c], b = c*3;
      compCurC[b] /= n; compCurC[b+1] /= n; compCurC[b+2] /= n;
    }

    compApq.fill(0, 0, nComp * 9);
    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3, m = c*9;
      const px = pos[o] - compCurC[b], py = pos[o+1] - compCurC[b+1], pz = pos[o+2] - compCurC[b+2];
      const qx = rest[o] - compRestC[b], qy = rest[o+1] - compRestC[b+1], qz = rest[o+2] - compRestC[b+2];
      compApq[m]   += px*qx; compApq[m+1] += px*qy; compApq[m+2] += px*qz;
      compApq[m+3] += py*qx; compApq[m+4] += py*qy; compApq[m+5] += py*qz;
      compApq[m+6] += pz*qx; compApq[m+7] += pz*qy; compApq[m+8] += pz*qz;
    }

    for (let c = 0; c < nComp; c++) {
      const m = c*9;
      if (!polar(compApq, m, _R)) {
        compT[m] = 1; compT[m+1] = 0; compT[m+2] = 0;
        compT[m+3] = 0; compT[m+4] = 1; compT[m+5] = 0;
        compT[m+6] = 0; compT[m+7] = 0; compT[m+8] = 1;
        continue;
      }
      let useLinear = false;
      if (compOk[c]) {
        mul3(compApq, m, compAqqInv, c*9, _A);
        const d = det3(_A, 0);
        if (d > 1e-7) {
          const sc = 1 / Math.cbrt(d);          // volume-preserving linear part
          for (let i = 0; i < 9; i++) _A[i] *= sc;
          useLinear = true;
        }
      }
      if (useLinear) for (let i = 0; i < 9; i++) compT[m+i] = tune.SM_BETA * _A[i] + (1 - tune.SM_BETA) * _R[i];
      else           for (let i = 0; i < 9; i++) compT[m+i] = _R[i];
    }

    for (let p = 0; p < N; p++) {
      const c = compOf[p];
      if (c < 0) continue;
      const o = p*3, b = c*3, m = c*9;
      const qx = rest[o] - compRestC[b], qy = rest[o+1] - compRestC[b+1], qz = rest[o+2] - compRestC[b+2];
      pos[o]   += (compT[m]   * qx + compT[m+1] * qy + compT[m+2] * qz + compCurC[b]     - pos[o])   * tune.SM_ALPHA;
      pos[o+1] += (compT[m+3] * qx + compT[m+4] * qy + compT[m+5] * qz + compCurC[b+1]   - pos[o+1]) * tune.SM_ALPHA;
      pos[o+2] += (compT[m+6] * qx + compT[m+7] * qy + compT[m+8] * qz + compCurC[b+2]   - pos[o+2]) * tune.SM_ALPHA;
    }
  }

  return {
    rebuild, apply, dampSpin,
    get nComp() { return nComp; },
    compOf,
  };
}
