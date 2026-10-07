/**
 * Las teclas sueltas de la app (`r`, `d`, flechas) se escuchan en `window`, así
 * que también llegan mientras el foco está en un control. Sin esta guarda, abrir
 * el selector de mecánica y teclear reinicia la sandía o abre el panel de tuneo.
 */
export function inControl(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t.isContentEditable === true;
}
