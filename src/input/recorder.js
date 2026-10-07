/**
 * Grabador de landmarks **crudos** (pre-One-Euro).
 *
 * Se guardan sin filtrar a propósito: así el filtro queda bajo test cuando el
 * fixture se reproduce, en vez de grabar su salida y darla por buena.
 *
 * Es la única forma de meter una sesión de mano real dentro de los tests. Sin
 * esto, el camino de tracking —que es la premisa del proyecto— solo se puede
 * probar a mano, con una cámara y un humano delante.
 */
const MAX_FRAMES = 1800;   // ~60 s a 30 fps

export function createRecorder() {
  let frames = null;
  let t0 = 0;

  function start() {
    frames = [];
    t0 = -1;
  }

  function capture(t, hands, handed) {
    if (!frames || frames.length >= MAX_FRAMES) return;
    if (t0 < 0) t0 = t;
    const out = [];
    if (hands) {
      for (let h = 0; h < hands.length; h++) {
        const label = handed && handed[h] && handed[h][0] && handed[h][0].categoryName;
        const pts = hands[h];
        const landmarks = new Array(21);
        for (let i = 0; i < 21; i++) {
          landmarks[i] = [round(pts[i].x), round(pts[i].y)];
        }
        out.push({ handedness: label || 'Right', landmarks });
      }
    }
    frames.push({ t: Math.round(t - t0), hands: out });
  }

  /** Corta la grabación y baja el JSON. @returns {number} frames grabados */
  function stopAndDownload(name) {
    if (!frames) return 0;
    const payload = {
      version: 1,
      recordedAt: new Date().toISOString(),
      frames,
    };
    const n = frames.length;
    frames = null;

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'landmarks') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return n;
  }

  return { start, capture, stopAndDownload, get recording() { return frames !== null; } };
}

const round = (v) => Math.round(v * 10000) / 10000;
