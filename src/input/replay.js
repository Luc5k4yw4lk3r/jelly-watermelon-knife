import { createHandPose } from './handPose.js';

/**
 * Reproduce una sesión de landmarks grabada, en lugar de la cámara.
 *
 * Se activa con `?replay=<url>`. Sirve para dos cosas: que los tests ejerciten
 * el camino de mano completo sin hardware, y poder reproducir una sesión real
 * para depurar algo que pasó una sola vez.
 *
 * Alimenta exactamente el mismo `handPose` que usa la cámara, así que lo que se
 * prueba es el código de producción, no una maqueta.
 */
export function createReplay() {
  const pose = createHandPose();
  let frames = null, i = 0, prevT = -1, looping = false;

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar el replay: ' + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.frames) || !data.frames.length) {
      throw new Error('El replay no tiene frames');
    }
    frames = data.frames;
    i = 0;
    prevT = -1;
    pose.reset();
    return frames.length;
  }

  function setLoop(on) { looping = on; }

  /**
   * Avanza **un frame grabado por llamada**, no por reloj de pared.
   *
   * Es la diferencia entre un replay útil y uno inservible: si se avanzara por
   * tiempo real, en una máquina que renderiza más lento que la grabación el
   * replay entero se consume entre dos frames. Avanzando de a uno, N frames
   * grabados son N frames renderizados y el resultado es determinista en
   * cualquier máquina — que es justo lo que un test necesita.
   *
   * @returns {number} el dt **grabado** en segundos, o 0 si no avanzó. Quien
   * llama se lo pasa a la hoja como `speedDt`, para que la velocidad sea la que
   * tuvo la mano de verdad y no la que permite el framerate de la máquina.
   */
  function update() {
    if (!frames) return 0;
    if (i >= frames.length) {
      if (!looping) return 0;
      i = 0; prevT = -1; pose.reset();
    }
    const f = frames[i++];
    const dt = prevT < 0 ? 1 / 30 : Math.min(0.2, Math.max(1 / 240, (f.t - prevT) / 1000));
    prevT = f.t;
    // el replay guarda [x, y]; handPose espera {x, y}, igual que MediaPipe
    const hands = f.hands.map((h) => h.landmarks.map(([x, y]) => ({ x, y })));
    const handed = f.hands.map((h) => [{ categoryName: h.handedness }]);
    pose.pushFrame(f.t, hands, handed);
    return dt;
  }

  return {
    load, setLoop, update,
    getPoses: (ndcToPlane) => pose.getPoses(ndcToPlane),
    get done() { return !!frames && i >= frames.length; },
    get total() { return frames ? frames.length : 0; },
    get at() { return i; },
  };
}
