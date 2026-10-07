/**
 * One Euro Filter, una instancia por canal escalar, empaquetado en typed arrays.
 * Es lo que saca el jitter de los landmarks sin agregar el retardo que un
 * promedio móvil metería en los movimientos rápidos.
 */
export function makeOneEuro(n, minCutoff = 1.6, beta = 0.85, dCutoff = 1.0) {
  const xHat = new Float32Array(n);
  const dxHat = new Float32Array(n);
  const has = new Uint8Array(n);
  const alpha = (cutoff, dt) => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };
  return {
    reset() { has.fill(0); },
    filter(i, x, dt) {
      if (!has[i]) { has[i] = 1; xHat[i] = x; dxHat[i] = 0; return x; }
      if (dt <= 0) return xHat[i];
      const dx = (x - xHat[i]) / dt;
      const ad = alpha(dCutoff, dt);
      dxHat[i] = ad * dx + (1 - ad) * dxHat[i];
      const cutoff = minCutoff + beta * Math.abs(dxHat[i]);
      const a = alpha(cutoff, dt);
      xHat[i] = a * x + (1 - a) * xHat[i];
      return xHat[i];
    },
  };
}
