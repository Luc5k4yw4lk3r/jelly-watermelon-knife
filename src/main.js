import { DT, DEFAULT_MECHANIC } from './config.js';

import { createLattice } from './physics/lattice.js';
import { createTopology } from './physics/topology.js';
import { createShapeMatcher } from './physics/shapeMatching.js';
import { createSolver } from './physics/solver.js';
import { createCutter } from './physics/cutting.js';

import { createScene } from './render/scene.js';
import { createJellyMesh } from './render/jellyMesh.js';
import { createJuice } from './render/juice.js';

import { createMouse } from './input/mouse.js';
import { createPointers } from './input/pointer.js';
import { createHandTracking } from './input/handTracking.js';
import { createOrbit } from './input/orbit.js';
import { createReplay } from './input/replay.js';
import { createRecorder } from './input/recorder.js';

import { MECHANICS, mechanicById } from './mechanics/registry.js';

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

/* ── objetos de escena ───────────────────────────────────────────────────── */

const jelly = createJellyMesh(lat, view.scene);
const juice = createJuice(view.scene, view.basis);

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
 */
function onCut(cut, blade, knife) {
  cutEvents++; severedTotal += cut.severed;
  rebuildAfterTopologyChange();
  juice.burst(cut, blade);
  sfx.squish(cut.strength);
  if (knife) knife.flash();
}

const ctx = {
  view, lat, topo, shape, jelly, juice, cutter, solver,
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
});
hud.setMechanic(mechId);

createTuner({ onStiffnessChange: lat.refreshStiffness, recorder, hud });

function reset() {
  cutEvents = 0; severedTotal = 0;
  lat.reset();
  juice.clear();
  rebuildAfterTopologyChange();
  hud.toast('Sandía nueva');
}

/** El corte cambia la topología; todo lo que depende de ella se rehace acá. */
let pieceCount = 1;
let cutEvents = 0, severedTotal = 0;   // telemetría: la lee ?dev
function rebuildAfterTopologyChange() {
  topo.rebuild();
  pieceCount = shape.rebuild();
  jelly.rebuild(topo);
  hud.setPieces(pieceCount);
}

/* ── frame loop ──────────────────────────────────────────────────────────── */

let acc = 0, lastT = performance.now(), fpsEma = 60, physMs = 0;

installDevtools({
  lat, topo, jelly, juice, replay,
  getBlades: () => mech.blades,
  getMechanic: () => mechId,
  getMechanicState: () => (mech.devState ? mech.devState() : null),
  getPieces: () => pieceCount,
  getPhysMs: () => physMs,
  getCuts: () => ({ events: cutEvents, severed: severedTotal }),
});

const replayUrl = new URLSearchParams(location.search).get('replay');
if (replayUrl) useReplay(replayUrl).catch((e) => hud.showError(e.message));

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
  jelly.material.uniforms.uTime.value = now * 0.001;

  view.render();
  hud.setFps(Math.round(fpsEma));
}

addEventListener('resize', view.resize);
view.resize();
rebuildAfterTopologyChange();
requestAnimationFrame(frame);
