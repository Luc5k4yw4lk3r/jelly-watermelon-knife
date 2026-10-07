import { tune, GRADES } from '../config.js';

/**
 * Lo que se ve de un corte puntuado: el porcentaje sobre cada mitad y un badge
 * central con la precisión y el rango.
 *
 * Las etiquetas se anclan al **centroide de cada pieza**, así que siguen a los
 * pedazos mientras caen. La proyección va en píxeles CSS (`view.worldToScreen`),
 * que es lo correcto para un overlay de DOM y lo que no se rompe con
 * `devicePixelRatio` 2.
 */

/** Color por rango, del mejor al peor. */
const TINT = ['#1f7a3a', '#3f9d4e', '#b8902a', '#d2692a', '#d8324a'];

export function createCutLabels(view) {
  const layer = document.getElementById('cutLabels');
  const badge = document.getElementById('cutBadge');
  if (!layer || !badge) return nullLabels();

  /** Pool de etiquetas; se crean a demanda y se reusan. */
  const pool = [];
  const live = [];        // { el, x, y, z }
  let until = 0;

  function take(i) {
    while (pool.length <= i) {
      const el = document.createElement('div');
      el.className = 'cutLabel';
      layer.appendChild(el);
      pool.push(el);
    }
    return pool[i];
  }

  /** Muestra el resultado de un golpe. */
  function show(played) {
    hide();
    let n = 0;
    for (let i = 0; i < played.entries.length; i++) {
      const e = played.entries[i];
      const anchors = played.anchors[i];
      const tint = TINT[Math.min(TINT.length - 1, GRADES.findIndex((g) => e.precision >= g.min))];
      for (let s = 0; s < 2; s++) {
        const at = anchors[s];
        if (!at) continue;
        const el = take(n++);
        el.textContent = e.split[s].toFixed(1) + '%';
        el.style.color = tint;
        el.classList.add('on');
        live.push({ el, x: at[0], y: at[1], z: at[2] });
      }
    }

    const head = played.entries[0];
    const avg = played.entries.length > 1 ? played.avg : head.precision;
    badge.innerHTML = `<b>${avg.toFixed(1)}</b><span>${head.grade}</span>`;
    badge.style.setProperty('--tint',
      TINT[Math.min(TINT.length - 1, GRADES.findIndex((g) => avg >= g.min))]);
    badge.classList.add('on');

    until = performance.now() + tune.LABEL_MS;
  }

  function hide() {
    for (const l of live) l.el.classList.remove('on');
    live.length = 0;
    badge.classList.remove('on');
  }

  const _p = { x: 0, y: 0, behind: false };

  /** Sigue a los pedazos mientras caen, y se apaga sola. */
  function update(now) {
    if (!live.length) return;
    if (now > until) { hide(); return; }
    for (const l of live) {
      view.worldToScreen(l.x, l.y, l.z, _p);
      l.el.style.opacity = _p.behind ? '0' : '';
      l.el.style.transform = `translate(${_p.x}px, ${_p.y}px) translate(-50%, -50%)`;
    }
  }

  return { show, update, clear: hide };
}

/** Sin DOM —tests en Node, o un HTML viejo— no hay nada que dibujar. */
function nullLabels() {
  return { show() {}, update() {}, clear() {} };
}
