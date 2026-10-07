/**
 * Todos los números que definen el comportamiento, en un solo lugar.
 *
 * Se dividen en dos grupos a propósito:
 *
 *  - Constantes **estructurales**: cambiarlas implica reconstruir la simulación
 *    entera (tamaños de typed arrays, topología de la rejilla). Se exportan como
 *    `const` y no se tocan en runtime.
 *
 *  - `tune`: valores que el panel de tuneo escribe **en vivo**. Van en un objeto
 *    mutable porque ajustar firmeza, gravedad y umbrales fue de lejos la parte
 *    más difícil de calibrar, y hacerlo recargando la página es inviable.
 */

/* ── estructural ─────────────────────────────────────────────────────────── */

export const NX = 12, NY = 10, NZ = 12;     // resolución de la lattice
export const RX = 1.00, RY = 0.86, RZ = 1.00; // radios del elipsoide
export const FLOOR_Y = -1.06;

export const DT = 1 / 60;                   // paso fijo de física
export const MAX_STEP_DISP = 0.09;          // tope anti-explosión por paso

export const SM_MIN = 12;                   // pedazo mínimo que recibe shape matching
export const MAX_COMP = 160;                // tope de componentes conexas simultáneas

export const BLADE_LEN  = 0.92;             // largo del filo, en unidades de mundo
export const BLADE_BACK = 0.05;             // el filo arranca apenas delante del agarre
export const BLADE_Z    = 0.55;             // profundidad a la que se dibuja el cuchillo
export const PLANE_Z    = 0;                // plano donde vive el corte

export const MAX_JUICE = 420;

/* Mecánica con la que arranca el juego. `?mech=<id>` la pisa, y el selector del
   HUD la cambia en caliente. Los ids están en `mechanics/registry.js`. */
export const DEFAULT_MECHANIC = 'handKnife';

/* MediaPipe se carga del CDN en runtime: su WASM y su modelo de 7.8 MB se bajan
   igual, así que empaquetar el wrapper no aportaría nada. */
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18';
export const MEDIAPIPE_MODULE = MEDIAPIPE_CDN + '/vision_bundle.mjs';
export const MEDIAPIPE_WASM = MEDIAPIPE_CDN + '/wasm';
export const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/* ── ajustable en vivo ───────────────────────────────────────────────────── */

export const tune = {
  // solver
  ITER: 2,                  // iteraciones de relajación de resortes
  GRAVITY: -9.4,
  DAMPING: 0.9918,

  // rigidez por iteración, por tipo de resorte
  K_STRUCT: 0.62,
  K_SHEAR: 0.38,
  K_BEND: 0.18,

  // shape matching
  SM_ALPHA: 0.32,           // tirón hacia la forma de reposo
  SM_BETA: 0.35,            // cuánta deformación lineal libre se permite
  SM_SPIN_DAMP: 0.03,       // drena el giro parásito de cuerpo rígido

  // piso
  FLOOR_FRICTION: 0.80,
  FLOOR_BOUNCE: 0.12,

  // hoja
  BLADE_R: 0.062,           // radio del colisionador (empuje lento)
  PUSH_CLAMP: 0.055,
  CUT_SPEED: 4.0,           // u/s a partir de las cuales corta en vez de empujar
  MAX_KERF: 0.085,          // ranura lateral máxima que puede abrir un barrido
  MAX_CUT_ROT: 0.18,        // rad/frame; una hoja que gira pica en vez de cortar
};

/** Copia de los valores de fábrica, para que el panel pueda restaurarlos. */
export const tuneDefaults = { ...tune };

/** Rigidez por tipo de resorte, en el orden de `SPRING_OFFSETS`. */
export const stiffnessByType = () => [tune.K_STRUCT, tune.K_SHEAR, tune.K_BEND];
