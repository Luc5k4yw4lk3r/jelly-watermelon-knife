/**
 * Todo el acceso al DOM de la interfaz, en un solo lugar.
 *
 * El HUD no sabe nada de física ni de render: recibe callbacks y expone setters.
 */
export function createHud({ onReset, onUseCamera, onUseMouse }) {
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
  };

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
    if (e.key === 'r' || e.key === 'R') onReset();
  });

  return { setSource, setTracking, setPieces, setFps, toast, showError, hideOverlay };
}
