import { DT, DEFAULT_MECHANIC, tune } from './config.js';

import { createLattice } from './physics/lattice.js';
import { createTopology } from './physics/topology.js';
import { createShapeMatcher } from './physics/shapeMatching.js';
import { createSolver } from './physics/solver.js';
import { createCutter } from './physics/cutting.js';
import { createVolumeMeter } from './physics/volume.js';
import { createPieceTracker } from './physics/pieces.js';

import { createScene } from './render/scene.js';
import { createJellyMesh } from './render/jellyMesh.js';
import { createJuice } from './render/juice.js';
import { createCutFaces } from './render/cutFaces.js';

import { createMouse } from './input/mouse.js';
import { createPointers } from './input/pointer.js';
import { createHandTracking } from './input/handTracking.js';
import { createOrbit } from './input/orbit.js';
import { createReplay } from './input/replay.js';
import { createRecorder } from './input/recorder.js';

import { MECHANICS, mechanicById } from './mechanics/registry.js';

import { createScoreboard } from './score/cutScore.js';
import { createCutLabels } from './ui/cutLabels.js';
import { createCutMeter } from './score/cutMeter.js';

import { sfx } from './audio/squish.js';
import { createHud } from './ui/hud.js';
import { createTuner } from './ui/tuner.js';
import { installDevtools, DEV, devState } from './ui/devtools.js';

/* ── render ──────────────────────────────────────────────────────────────── */

/* La escena va primero: el corte y la colisión trabajan en la base de la cámara
   (derecha / arriba / profundidad), que es lo que permite orbitar sin que el
   plano de corte deje de coincidir con lo que se ve. */
const canvas = document.getElementById('gl');
const view = createScene(canvas);

/* ── simulación ──────────────────────────────────────────────────────────── */

const lat = createLattice();
const topo = createTopology(lat);
const shape = createShapeMatcher(lat);
const solver = createSolver(lat, shape, view.basis);
const cutter = createCutter(lat, view.basis);
const volume = createVolumeMeter(lat);
const pieces = createPieceTracker(lat);

/* ── objetos de escena ───────────────────────────────────────────────────── */

const jelly = createJellyMesh(lat, view.scene);
const juice = createJuice(view.scene, view.basis);
/* La cara de corte sub-celda. Comparte el material de la gelatina, así que el
   shader la pinta como pulpa sin saber que existe. */
const cutFaces = createCutFaces(lat, view.scene, jelly.material);

view.onResize.push(juice.setPixelScale);

/* ── entrada ─────────────────────────────────────────────────────────────── */

const replay = createReplay();
const recorder = createRecorder();
const mouse = createMouse(canvas);
const mousePoses = [null, null];
const orbit = createOrbit(canvas, view.orbit);
const hand = createHandTracking({
  onStatus: ({ source, tracking }) => {
    if (source === 'hand') hud.setSource('Mano', true);
    if (tracking !== undefined) hud.setTracking(tracking);
  },
});

const pointers = createPointers({ mouse, hand, replay });

let source = 'none';   // 'hand' | 'mouse' | 'replay'
hand.setRecorder(recorder);

function useMouse() {
  source = 'mouse';
  hand.stop();
  hud.setSource('Mouse', false);
}

async function useCamera() {
  await hand.start();
  source = 'hand';
}

/* Reproducir una sesión grabada en vez de usar la cámara: `?replay=<url>`.
   Alimenta el mismo handPose que usa la cámara, así que lo que corre es el
   código de producción. */
async function useReplay(url) {
  const n = await replay.load(url);
  replay.setLoop(new URLSearchParams(location.search).has('loop'));
  source = 'replay';
  hud.setSource('Replay', true);
  hud.hideOverlay();
  hud.toast(n + ' frames de replay');
}

/* ── mecánicas ───────────────────────────────────────────────────────────── */

/**
 * Los efectos de un corte viven **acá y solo acá**: el cutter es puro y las
 * mecánicas deciden *cuándo* cortar, no qué pasa después.
 *
 * `plane` es opcional: si la mecánica cortó por un plano, se mide la precisión
 * del reparto. El tajo libre corta con un cuadrilátero barrido, no con un
 * plano, así que ahí no hay un split que medir y no se inventa un número.
 */
function onCut(cut, blade, knife, plane) {
  cutEvents++; severedTotal += cut.severed;
  rebuildAfterTopologyChange(plane);
  juice.burst(cut, blade);
  sfx.squish(cut.strength);
  if (knife) knife.flash();
}

const ctx = {
  view, lat, topo, shape, jelly, juice, cutter, solver, volume,
  onCut,
  getPieces: () => pieceCount,
};

/* Se construyen todas de entrada y se prenden y apagan con enter/exit: cambiar
   de mecánica no puede pagar la creación de mallas en el frame del cambio. */
const built = new Map();
for (const m of MECHANICS) built.set(m.id, m.create(ctx));

const wanted = new URLSearchParams(location.search).get('mech');
let mechId = mechanicById(wanted) ? wanted : DEFAULT_MECHANIC;
let mech = built.get(mechId);
mech.enter();

function setMechanic(id) {
  const next = built.get(id);
  if (!next || next === mech) return;
  /* La saliente cancela lo que tenga en curso y se esconde. La lattice no se
     toca, así que los pedazos se conservan solos. */
  mech.exit();
  mech = next;
  mechId = id;
  mech.enter();
  hud.setMechanic(id);
}

/* ── UI ──────────────────────────────────────────────────────────────────── */

const hud = createHud({
  onReset: reset,
  onUseCamera: () => { sfx.init(); return useCamera(); },
  onUseMouse: () => { sfx.init(); useMouse(); },
  mechanics: MECHANICS,
  onMechanic: setMechanic,
  onPractice: () => { practiceAcc = 0; },
  onStatsReset: () => { scoreboard.reset(); hud.setStats(scoreboard.stats()); },
});
hud.setMechanic(mechId);

createTuner({ onStiffnessChange: lat.refreshStiffness, recorder, hud });

function reset() {
  cutEvents = 0; severedTotal = 0;
  lat.reset();
  juice.clear();
  pieces.reset();
  labels.clear();
  rebuildAfterTopologyChange();
  hud.toast('Sandía nueva');
}

/** El corte cambia la topología; todo lo que depende de ella se rehace acá. */
let pieceCount = 1;
let cutEvents = 0, severedTotal = 0;   // telemetría: la lee ?dev
/** El recorte lo prende el interruptor del panel, o la mecánica que lo trae. */
const subcellOn = () => tune.SUBCELL || !!mechanicById(mechId)?.subcell;

function rebuildAfterTopologyChange(plane) {
  topo.rebuild();
  /* Acá, y no dentro de la mecánica: es el único punto por el que pasan todos
     los cambios de topología, igual que la medición del puntaje. */
  if (plane && subcellOn()) cutFaces.rebuild(plane, topo);
  else if (!plane) cutFaces.clear();
  pieceCount = shape.rebuild();
  const splits = pieces.rebuild();
  jelly.rebuild(topo);
  hud.setPieces(pieceCount);

  /* Es el único punto por el que pasan todos los cambios de topología, así que
     medir acá cubre las dos mecánicas y el reset sin que ninguna lo sepa. */
  if (plane && splits.length) {
    const played = meter.measure(splits, plane, source);
    if (played) {
      labels.show(played);
      hud.setStats(scoreboard.stats());
    }
  }
}

/* ── frame loop ──────────────────────────────────────────────────────────── */

let acc = 0, lastT = performance.now(), fpsEma = 60, physMs = 0;

installDevtools({
  lat, topo, jelly, juice, replay, pieces, cutFaces,
  getBlades: () => mech.blades,
  getMechanic: () => mechId,
  getMechanicState: () => (mech.devState ? mech.devState() : null),
  getPieces: () => pieceCount,
  getPhysMs: () => physMs,
  getCuts: () => ({ events: cutEvents, severed: severedTotal }),
  cutLine: (ax, az, bx, bz) => (mech.devCut ? mech.devCut(ax, az, bx, bz) : null),
  /* Mide **ahora** el reparto de una línea, sin cortar. Es el mismo camino que
     usa el modo práctica, y lo que permite comprobar que la medición no se mueve
     con el bamboleo: leer dos veces el puntaje guardado no probaría nada, porque
     es un registro del historial y no cambia aunque la medición fuera inestable. */
  splitAt: (ax, az, bx, bz) => {
    let dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-6)) return null;
    dx /= len; dz /= len;
    const [p, q] = volume.splitByPlane(ax, view.target.y, az, -dz, 0, dx);
    const t = p + q;
    return [(100 * p) / t, (100 * q) / t];
  },
  getScore: () => ({
    stats: scoreboard.stats(),
    last: scoreboard.history[scoreboard.history.length - 1] || null,
    history: scoreboard.history,
  }),
});

const scoreboard = createScoreboard();
const meter = createCutMeter({
  lat, volume, pieces, scoreboard,
  // la comprobación cruzada de volumen solo corre con ?dev: cuesta una pasada más
  onWarn: DEV ? (msg) => console.warn('[score]', msg) : null,
});
const labels = createCutLabels(view);

const replayUrl = new URLSearchParams(location.search).get('replay');
if (replayUrl) useReplay(replayUrl).catch((e) => hud.showError(e.message));

/**
 * Modo práctica: el reparto que daría la línea que se está dibujando, sin
 * cortar nada. Se recalcula a 10 Hz con el mismo idioma de acumulador que usa
 * la física, porque recorrer las 1089 celdas en cada frame no hace falta para
 * un número que el ojo lee cinco veces por segundo.
 */
let practiceAcc = 0;
const practicePlane = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0 };
const practicePair = [0, 0];

function updatePractice(dt) {
  if (!hud.practiceOn()) return;
  practiceAcc += dt;
  if (practiceAcc < 0.1) return;
  practiceAcc = 0;

  const a = mech.aim ? mech.aim() : null;
  if (!a) { hud.setPracticeSplit(null); return; }

  let dx = a.bx - a.ax, dz = a.bz - a.az;
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-4)) { hud.setPracticeSplit(null); return; }
  dx /= len; dz /= len;

  practicePlane.px = a.ax; practicePlane.py = a.y; practicePlane.pz = a.az;
  practicePlane.nx = -dz;  practicePlane.ny = 0;   practicePlane.nz = dx;

  const [p, q] = volume.splitByPlane(
    practicePlane.px, practicePlane.py, practicePlane.pz,
    practicePlane.nx, practicePlane.ny, practicePlane.nz);
  const t = p + q;
  practicePair[0] = (100 * p) / t;
  practicePair[1] = (100 * q) / t;
  hud.setPracticeSplit(practicePair);
}

// se reusa: el loop no debe asignar nada por frame
const io = { poses: null, pointers: null, source: 'none', rawDt: DT, replayDt: 0 };
// agarre de referencia para las mecánicas que no orientan la hoja por movimiento
const ORIGIN = { x: 0, y: 0 };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = DT;
  const rawDt = dt;              // sin recortar: la velocidad de hoja lo necesita
  if (dt > 0.1) dt = 0.1;
  fpsEma += (1 / dt - fpsEma) * 0.08;

  if (view.adaptResolution(fpsEma)) fpsEma = 60;
  orbit.update(dt);

  let poses, replayDt = 0;
  if (source === 'hand') {
    poses = hand.getPoses(view.ndcToPlane);
  } else if (source === 'replay') {
    replayDt = replay.update();
    poses = replay.getPoses(view.ndcToPlane);
  } else {
    mousePoses[0] = source === 'mouse'
      ? mouse.getPose(view.ndcToPlane, mech.grip ? mech.grip() : ORIGIN)
      : null;
    poses = mousePoses;   // el mouse maneja un solo cuchillo
  }

  io.poses = poses;
  io.pointers = pointers.get(source);
  io.source = source;
  io.rawDt = rawDt;
  io.replayDt = replayDt;
  mech.update(dt, io);

  const frozen = DEV && devState.paused;

  acc += dt;
  let steps = 0;
  const t0 = performance.now();
  if (!frozen) {
    const blades = mech.blades;
    while (acc >= DT && steps < 3) { solver.step(DT, blades); acc -= DT; steps++; }
  } else acc = 0;
  physMs = physMs * 0.9 + (performance.now() - t0) * 0.1;
  if (acc > DT) acc = 0;

  if (!frozen) juice.update(dt);
  if (DEV && devState.juiceVisible !== null) juice.points.visible = devState.juiceVisible;
  jelly.update(topo);
  /* Después de `jelly.update`, que es quien recalcula el suavizado: la cara de
     corte se apoya en las mismas posiciones, o va un frame atrás de la corteza. */
  cutFaces.update(shape, jelly.renderPositions());
  jelly.material.uniforms.uTime.value = now * 0.001;

  updatePractice(dt);
  labels.update(now);

  view.render();
  hud.setFps(Math.round(fpsEma));
}

addEventListener('resize', view.resize);
view.resize();
rebuildAfterTopologyChange();
requestAnimationFrame(frame);
