import { inControl } from './focus.js';

/**
 * Todo el acceso al DOM de la interfaz, en un solo lugar.
 *
 * El HUD no sabe nada de física ni de render: recibe callbacks y expone setters.
 */
export function createHud({
  onReset, onUseCamera, onUseMouse, mechanics = [], onMechanic,
  onPractice, onStatsReset,
}) {
  const el = {
    overlay:  document.getElementById('overlay'),
    btnCam:   document.getElementById('btnCam'),
    btnMouse: document.getElementById('btnMouse'),
    btnReset: document.getElementById('btnReset'),
    camErr:   document.getElementById('camErr'),
    camTag:   document.getElementById('camTag'),
    preview:  document.getElementById('preview'),
    pieces:   document.getElementById('pieces'),
    fps:      document.getElementById('fps'),
    srcDot:   document.getElementById('srcDot'),
    srcLabel: document.getElementById('srcLabel'),
    toast:    document.getElementById('toast'),
    mechChip: document.getElementById('mechChip'),
    mechSel:  document.getElementById('mech'),
    hint:     document.getElementById('hint'),
    statsChip: document.getElementById('statsChip'),
    statLast:  document.getElementById('statLast'),
    statBest:  document.getElementById('statBest'),
    statAvg:   document.getElementById('statAvg'),
    btnStats:  document.getElementById('btnStatsReset'),
    practiceChip:  document.getElementById('practiceChip'),
    practice:      document.getElementById('practice'),
    practiceSplit: document.getElementById('practiceSplit'),
  };

  /* Con una sola mecánica el selector es ruido; aparece cuando hay algo que
     elegir. */
  el.mechChip.hidden = mechanics.length < 2;
  for (const m of mechanics) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    el.mechSel.appendChild(opt);
  }
  el.mechSel.addEventListener('change', () => onMechanic(el.mechSel.value));

  /** El selector refleja la mecánica activa, y la pista de abajo la describe. */
  function setMechanic(id) {
    el.mechSel.value = id;
    const m = mechanics.find((x) => x.id === id);
    if (m && m.hint) el.hint.innerHTML = m.hint;
    /* Puntaje y práctica solo tienen sentido donde el corte es un plano. */
    const scores = !!(m && m.scores);
    el.statsChip.hidden = !scores;
    el.practiceChip.hidden = !scores;
    if (!scores) setPracticeSplit(null);
  }

  const n1 = (v) => (v === null || v === undefined ? '—' : v.toFixed(1));

  /** Último, mejor y promedio de la sesión. */
  function setStats(st) {
    el.statLast.textContent = n1(st.last);
    el.statBest.textContent = n1(st.best);
    el.statAvg.textContent = n1(st.avg);
  }

  /** Reparto proyectado del trazo en curso, en modo práctica. */
  function setPracticeSplit(pair) {
    el.practiceSplit.textContent = pair
      ? pair[0].toFixed(0) + '/' + pair[1].toFixed(0)
      : '—';
  }

  const practiceOn = () => el.practice.checked;
  function setPractice(on) { el.practice.checked = !!on; }

  el.practice.addEventListener('change', () => {
    setPracticeSplit(null);
    if (onPractice) onPractice(el.practice.checked);
  });
  el.btnStats.addEventListener('click', () => { if (onStatsReset) onStatsReset(); });

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2600);
  }

  function setSource(label, on) {
    el.srcLabel.textContent = label;
    el.srcDot.classList.toggle('off', !on);
    el.preview.classList.toggle('on', !!on);
  }

  function setTracking(found) {
    el.camTag.textContent = found ? 'tracking' : 'buscando mano…';
    el.camTag.classList.toggle('lost', !found);
  }

  const setPieces = (n) => { el.pieces.textContent = n; };
  const setFps = (n) => { el.fps.textContent = n + ' FPS'; };
  const hideOverlay = () => el.overlay.classList.add('hidden');

  function showError(msg) {
    el.camErr.textContent = msg;
    el.camErr.classList.add('on');
  }

  el.btnCam.addEventListener('click', async () => {
    el.camErr.classList.remove('on');
    el.btnCam.disabled = true;
    el.btnCam.textContent = 'Iniciando…';
    try {
      await onUseCamera();
      hideOverlay();
    } catch (e) {
      showError((e && e.message ? e.message : 'Falló la cámara.') + ' Seguimos con el mouse.');
      onUseMouse();
      setTimeout(hideOverlay, 1400);
    } finally {
      el.btnCam.disabled = false;
      el.btnCam.textContent = 'Activar cámara';
    }
  });

  el.btnMouse.addEventListener('click', () => {
    onUseMouse();
    hideOverlay();
  });

  el.btnReset.addEventListener('click', onReset);
  addEventListener('keydown', (e) => {
    if (inControl(e)) return;
    if (e.key === 'r' || e.key === 'R') onReset();
  });

  return {
    setSource, setTracking, setPieces, setFps, setMechanic,
    setStats, setPractice, setPracticeSplit, practiceOn,
    toast, showError, hideOverlay,
  };
}
