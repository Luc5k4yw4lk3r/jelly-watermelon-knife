import { makeOneEuro } from './oneEuro.js';
import { MEDIAPIPE_MODULE, MEDIAPIPE_WASM, HAND_MODEL } from '../config.js';

const HAND_LINKS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

/**
 * Tracking de mano con MediaPipe Tasks Vision.
 *
 * Corre sobre `requestVideoFrameCallback`, es decir al ritmo de la cámara y
 * nunca dentro del render loop: `detectForVideo` es sincrónico y bloquearía un
 * frame cada vez. Los 21 landmarks se suavizan con One Euro.
 */
export function createHandTracking({ onStatus = () => {} } = {}) {
  /* Dos manos, dos cuchillos. Cada slot tiene su propio banco de filtros: slot 0
     es la mano izquierda, slot 1 la derecha. Se asigna por la handedness que
     reporta MediaPipe y no por el orden del array, que no es estable: si no,
     los cuchillos se intercambian solos de un frame al otro. */
  const HANDS = 2;
  const euro = [makeOneEuro(42, 1.6, 0.9, 1.0), makeOneEuro(42, 1.6, 0.9, 1.0)];
  const lm = new Float32Array(HANDS * 42);   // landmarks suavizados (normalizados, 21 x xy)
  const seen = [false, false];
  const lastAt = [-1e9, -1e9];

  const video = document.getElementById('cam');
  const lmkCanvas = document.getElementById('lmk');
  const lmkCtx = lmkCanvas.getContext('2d');

  let mode = 'none';
  let landmarker = null, trackingLoop = false, lastDetectT = -1;

  async function startCamera() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (e) {
      throw new Error('No se pudo acceder a la cámara (' + (e && e.name ? e.name : 'error') + ').');
    }
    video.srcObject = stream;
    await video.play();

    const vision = await import(/* @vite-ignore */ MEDIAPIPE_MODULE)
      .catch(() => { throw new Error('No se pudo cargar MediaPipe desde el CDN. ¿Hay conexión?'); });
    const fileset = await vision.FilesetResolver.forVisionTasks(
      MEDIAPIPE_WASM
    );
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: HAND_MODEL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    } catch (e) {
      // some drivers reject the GPU delegate — fall back to CPU rather than to the mouse
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: HAND_MODEL,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      });
    }

    mode = 'hand';
    euro[0].reset(); euro[1].reset();
    onStatus({ source: 'hand' });
    startTrackingLoop();
  }

  /* Tracking runs on the video's own cadence (requestVideoFrameCallback), never
     inside the render loop, so MediaPipe never stalls a frame. */
  function startTrackingLoop() {
    if (trackingLoop) return;
    trackingLoop = true;

    const detect = () => {
      if (mode !== 'hand' || !landmarker) { trackingLoop = false; return; }
      const t = performance.now();
      if (video.readyState >= 2 && t > lastDetectT) {
        lastDetectT = t;
        let res = null;
        try { res = landmarker.detectForVideo(video, t); } catch (_) { res = null; }
        const hands = res && res.landmarks;
        const handed = res && res.handednesses;
        const taken = [false, false];
        if (hands && hands.length) {
          for (let h = 0; h < hands.length && h < HANDS; h++) {
            const label = handed && handed[h] && handed[h][0] && handed[h][0].categoryName;
            let slot = label === 'Left' ? 0 : 1;
            if (taken[slot]) slot = 1 - slot;      // ambas con la misma etiqueta
            if (taken[slot]) continue;
            taken[slot] = true;

            const pts = hands[h];
            const base = slot * 42;
            const dt = seen[slot] ? Math.min(0.1, Math.max(1 / 120, (t - lastAt[slot]) / 1000)) : 1 / 30;
            if (!seen[slot]) euro[slot].reset();
            for (let i = 0; i < 21; i++) {
              lm[base + i * 2]     = euro[slot].filter(i * 2,     pts[i].x, dt);
              lm[base + i * 2 + 1] = euro[slot].filter(i * 2 + 1, pts[i].y, dt);
            }
            seen[slot] = true;
            lastAt[slot] = t;
          }
        }
        for (let slot = 0; slot < HANDS; slot++) {
          if (!taken[slot] && t - lastAt[slot] > 180) seen[slot] = false;
        }
        drawPreview(seen[0] || seen[1]);
      }
      schedule();
    };

    const schedule = () => {
      if (mode !== 'hand') { trackingLoop = false; return; }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => detect());
      else setTimeout(detect, 24);
    };
    schedule();
  }

  function drawPreview(found) {
    const w = lmkCanvas.width, h = lmkCanvas.height;
    lmkCtx.clearRect(0, 0, w, h);
    onStatus({ tracking: found });
    if (!found) return;

    for (let slot = 0; slot < HANDS; slot++) {
      if (!seen[slot]) continue;
      const base = slot * 42;

      lmkCtx.lineWidth = 1.6;
      lmkCtx.strokeStyle = 'rgba(120,255,170,.55)';
      lmkCtx.beginPath();
      for (let i = 0; i < HAND_LINKS.length; i++) {
        const [a, b] = HAND_LINKS[i];
        lmkCtx.moveTo(lm[base + a * 2] * w, lm[base + a * 2 + 1] * h);
        lmkCtx.lineTo(lm[base + b * 2] * w, lm[base + b * 2 + 1] * h);
      }
      lmkCtx.stroke();

      // se resalta el eje muñeca -> nudillo del índice, que es el que guía la hoja
      lmkCtx.lineWidth = 2.6;
      lmkCtx.strokeStyle = 'rgba(255,92,118,.95)';
      lmkCtx.beginPath();
      lmkCtx.moveTo(lm[base] * w, lm[base + 1] * h);
      lmkCtx.lineTo(lm[base + 10] * w, lm[base + 11] * h);
      lmkCtx.stroke();

      lmkCtx.fillStyle = 'rgba(255,255,255,.92)';
      for (let i = 0; i < 21; i++) {
        lmkCtx.beginPath();
        lmkCtx.arc(lm[base + i * 2] * w, lm[base + i * 2 + 1] * h, 2.0, 0, 6.2832);
        lmkCtx.fill();
      }
    }
  }

  function stop() {
    mode = 'none';
    landmarker = null;
    seen[0] = seen[1] = false;
    const stream = video.srcObject;
    if (stream) { for (const t of stream.getTracks()) t.stop(); video.srcObject = null; }
  }

  const _p0 = { x: 0, y: 0 }, _p1 = { x: 0, y: 0 };

  /**
   * Posición desde el punto medio muñeca–nudillo del índice; orientación desde
   * ese mismo vector. La X se espeja para que mover la mano a la derecha mueva
   * el cuchillo a la derecha.
   */
  const poses = [
    { gx: 0, gy: 0, dirx: 0, diry: 1 },
    { gx: 0, gy: 0, dirx: 0, diry: 1 },
  ];
  const out = [null, null];

  /** @returns {Array<null|{gx,gy,dirx,diry}>} una pose por slot, o null. */
  function getPoses(ndcToPlane) {
    for (let slot = 0; slot < HANDS; slot++) {
      if (mode !== 'hand' || !seen[slot]) { out[slot] = null; continue; }
      const base = slot * 42;
      ndcToPlane(1 - 2 * lm[base],      1 - 2 * lm[base + 1],  _p0);
      ndcToPlane(1 - 2 * lm[base + 10], 1 - 2 * lm[base + 11], _p1);
      let dx = _p1.x - _p0.x, dy = _p1.y - _p0.y;
      const l = Math.hypot(dx, dy);
      if (l > 1e-4) { dx /= l; dy /= l; } else { dx = 0; dy = 1; }
      const pose = poses[slot];
      pose.gx = (_p0.x + _p1.x) * 0.5;
      pose.gy = (_p0.y + _p1.y) * 0.5;
      pose.dirx = dx; pose.diry = dy;
      out[slot] = pose;
    }
    return out;
  }

  return { start: startCamera, stop, getPoses, get active() { return mode === 'hand'; } };
}
