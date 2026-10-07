import { MEDIAPIPE_MODULE, MEDIAPIPE_WASM, HAND_MODEL } from '../config.js';
import { createHandPose, HANDS, HAND_LINKS } from './handPose.js';

const EMPTY = [null, null];

/**
 * La cáscara de hardware del tracking: cámara, MediaPipe, preview.
 *
 * Corre sobre `requestVideoFrameCallback`, es decir al ritmo de la cámara y
 * nunca dentro del render loop: `detectForVideo` es sincrónico y bloquearía un
 * frame cada vez.
 *
 * Toda la lógica de landmarks vive en handPose.js, que no depende de nada de
 * esto. Acá solo se consiguen frames y se dibuja el preview.
 */
export function createHandTracking({ onStatus = () => {} } = {}) {
  const pose = createHandPose();
  const lm = pose.landmarks;

  const video = document.getElementById('cam');
  const lmkCanvas = document.getElementById('lmk');
  const lmkCtx = lmkCanvas.getContext('2d');

  let mode = 'none';
  let landmarker = null, trackingLoop = false, lastDetectT = -1;
  let recorder = null;

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
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: HAND_MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: HANDS,
    });
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      // algunos drivers rechazan el delegate GPU: mejor caer a CPU que al mouse
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('CPU'));
    }

    mode = 'hand';
    pose.reset();
    onStatus({ source: 'hand' });
    startTrackingLoop();
  }

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
        if (recorder) recorder.capture(t, hands, handed);
        drawPreview(pose.pushFrame(t, hands, handed));
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
      if (!pose.seen[slot]) continue;
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
    pose.reset();
    const stream = video.srcObject;
    if (stream) { for (const t of stream.getTracks()) t.stop(); video.srcObject = null; }
  }

  /** Engancha un grabador de landmarks crudos (ver input/recorder.js). */
  function setRecorder(r) { recorder = r; }

  return {
    start: startCamera,
    stop,
    setRecorder,
    getPoses: (ndcToPlane) => (mode === 'hand' ? pose.getPoses(ndcToPlane) : EMPTY),
    get active() { return mode === 'hand'; },
  };
}
