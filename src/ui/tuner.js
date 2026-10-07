import { tune, tuneDefaults } from '../config.js';
import { inControl } from './focus.js';

/**
 * Panel de tuneo en vivo, con `D`.
 *
 * Calibrar firmeza, gravedad y umbrales fue de lejos la parte más difícil de
 * construir esto, y hacerlo editando constantes y recargando es inviable: la
 * sensación de la gelatina solo se juzga moviéndola. El panel escribe
 * directamente sobre `tune`, que es el mismo objeto que lee el solver.
 *
 * A mano y sin dependencias: el proyecto no tiene deps de runtime más allá de
 * three, y conviene que siga así.
 */

const GROUPS = [
  {
    title: 'Gelatina',
    fields: [
      { key: 'SM_ALPHA', label: 'Firmeza', min: 0, max: 0.8, step: 0.01 },
      { key: 'SM_BETA', label: 'Squish', min: 0, max: 0.8, step: 0.01 },
      { key: 'GRAVITY', label: 'Gravedad', min: -20, max: 0, step: 0.1 },
      { key: 'DAMPING', label: 'Amortiguación', min: 0.95, max: 1, step: 0.0005 },
    ],
  },
  {
    title: 'Resortes',
    fields: [
      { key: 'ITER', label: 'Iteraciones', min: 1, max: 6, step: 1 },
      { key: 'K_STRUCT', label: 'Estructural', min: 0.1, max: 1, step: 0.01, stiffness: true },
      { key: 'K_SHEAR', label: 'Shear', min: 0, max: 1, step: 0.01, stiffness: true },
      { key: 'K_BEND', label: 'Flexión', min: 0, max: 1, step: 0.01, stiffness: true },
    ],
  },
  {
    title: 'Cuchillo',
    fields: [
      { key: 'CUT_SPEED', label: 'Umbral de corte', min: 1, max: 12, step: 0.1 },
      { key: 'MAX_KERF', label: 'Kerf', min: 0.02, max: 0.2, step: 0.005 },
      { key: 'BLADE_R', label: 'Radio de hoja', min: 0.02, max: 0.15, step: 0.005 },
      { key: 'MAX_CUT_ROT', label: 'Giro máx. al cortar', min: 0.05, max: 1, step: 0.01 },
    ],
  },
];

function fmt(v, step) {
  if (step >= 1) return String(Math.round(v));
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return v.toFixed(decimals);
}

export function createTuner({ onStiffnessChange, recorder, hud }) {
  const panel = document.createElement('aside');
  panel.id = 'tuner';
  panel.setAttribute('aria-label', 'Panel de tuneo');
  panel.hidden = true;

  const rows = [];

  const head = document.createElement('header');
  head.innerHTML = '<b>Tuneo</b><span>D para cerrar</span>';
  panel.appendChild(head);

  for (const group of GROUPS) {
    const h = document.createElement('h4');
    h.textContent = group.title;
    panel.appendChild(h);

    for (const f of group.fields) {
      const row = document.createElement('label');
      row.className = 'trow';

      const name = document.createElement('span');
      name.className = 'tname';
      name.textContent = f.label;

      const val = document.createElement('span');
      val.className = 'tval';
      val.textContent = fmt(tune[f.key], f.step);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = f.min; input.max = f.max; input.step = f.step;
      input.value = tune[f.key];

      input.addEventListener('input', () => {
        tune[f.key] = parseFloat(input.value);
        val.textContent = fmt(tune[f.key], f.step);
        if (f.stiffness) onStiffnessChange();
      });

      row.append(name, val, input);
      panel.appendChild(row);
      rows.push({ input, val, key: f.key, step: f.step });
    }
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'treset';
  reset.textContent = 'Valores de fábrica';
  reset.addEventListener('click', () => {
    Object.assign(tune, tuneDefaults);
    for (const r of rows) { r.input.value = tune[r.key]; r.val.textContent = fmt(tune[r.key], r.step); }
    onStiffnessChange();
  });
  panel.appendChild(reset);

  /* Grabador de landmarks. Vive acá y no en el HUD principal porque es una
     herramienta de desarrollo: sirve para capturar fixtures de mano real, que
     es lo único que hace testeable el camino de tracking. */
  if (recorder) {
    const rec = document.createElement('button');
    rec.type = 'button';
    rec.className = 'treset trec';
    rec.textContent = '● Grabar landmarks';
    rec.addEventListener('click', () => {
      if (recorder.recording) {
        const n = recorder.stopAndDownload('landmarks');
        rec.textContent = '● Grabar landmarks';
        rec.classList.remove('on');
        if (hud) hud.toast(n ? n + ' frames guardados' : 'No se grabó nada');
      } else {
        recorder.start();
        rec.textContent = '■ Detener y bajar';
        rec.classList.add('on');
        if (hud) hud.toast('Grabando… activá la cámara si no lo hiciste');
      }
    });
    panel.appendChild(rec);
  }

  document.body.appendChild(panel);

  function toggle() { panel.hidden = !panel.hidden; }

  addEventListener('keydown', (e) => {
    if (inControl(e)) return;
    if (e.key === 'd' || e.key === 'D') toggle();
  });

  return { toggle, get open() { return !panel.hidden; } };
}
