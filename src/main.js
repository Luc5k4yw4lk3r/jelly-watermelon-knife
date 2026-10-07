import { DT } from './config.js';

import { createLattice } from './physics/lattice.js';
import { createTopology } from './physics/topology.js';
import { createShapeMatcher } from './physics/shapeMatching.js';
import { createSolver } from './physics/solver.js';
import { createCutter } from './physics/cutting.js';

import { createScene } from './render/scene.js';
import { createJellyMesh } from './render/jellyMesh.js';
import { createKnife } from './render/knife.js';
import { createJuice } from './render/juice.js';

import { createBlade } from './input/blade.js';
import { createMouse } from './input/mouse.js';
import { createHandTracking } from './input/handTracking.js';
import { createOrbit } from './input/orbit.js';
import { createReplay } from './input/replay.js';
import { createRecorder } from './input/recorder.js';

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
// un cuchillo por mano: el tracking reporta hasta dos
const knives = [createKnife(view.scene, view.camera, view), createKnife(view.scene, view.camera, view)];

view.onResize.push(juice.setPixelScale);

/* ── entrada ─────────────────────────────────────────────────────────────── */

const replay = createReplay();
const recorder = createRecorder();
const hands = [createBlade(), createBlade()];
const blades = hands.map((h) => h.blade);     // el solver recibe los estados
const mouse = createMouse();
const mousePoses = [null, null];
const orbit = createOrbit(canvas, view.orbit);
const hand = createHandTracking({
  onStatus: ({ source, tracking }) => {
    if (source === 'hand') hud.setSource('Mano', true);
    if (tracking !== undefined) hud.setTracking(tracking);
  },
});

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

/* ── UI ──────────────────────────────────────────────────────────────────── */

const hud = createHud({
  onReset: reset,
  onUseCamera: () => { sfx.init(); return useCamera(); },
  onUseMouse: () => { sfx.init(); useMouse(); },
});

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
  lat, topo, jelly, juice, blades, replay,
  getPieces: () => pieceCount,
  getPhysMs: () => physMs,
  getCuts: () => ({ events: cutEvents, severed: severedTotal }),
});

const replayUrl = new URLSearchParams(location.search).get('replay');
if (replayUrl) useReplay(replayUrl).catch((e) => hud.showError(e.message));

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
      ? mouse.getPose(view.ndcToPlane, { x: blades[0].gx, y: blades[0].gy })
      : null;
    poses = mousePoses;   // el mouse maneja un solo cuchillo
  }

  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    // en replay la velocidad usa el dt grabado: así el tajo es el que hizo la
    // mano, y no el que deja el framerate de la máquina que lo reproduce
    h.update(dt, poses[i] || null, source === 'replay' && replayDt ? replayDt : rawDt);

    // CORTE: una hoja rápida elimina todo resorte cuyo segmento cruce el área barrida
    if (h.shouldCut()) {
      const cut = cutter.cut(h.blade);
      if (cut.severed) {
        cutEvents++; severedTotal += cut.severed;
        rebuildAfterTopologyChange();
        juice.burst(cut, h.blade);
        sfx.squish(cut.strength);
        knives[i].flash();
      }
    }
  }

  const frozen = DEV && devState.paused;

  acc += dt;
  let steps = 0;
  const t0 = performance.now();
  if (!frozen) {
    while (acc >= DT && steps < 3) { solver.step(DT, blades); acc -= DT; steps++; }
  } else acc = 0;
  physMs = physMs * 0.9 + (performance.now() - t0) * 0.1;
  if (acc > DT) acc = 0;

  for (let i = 0; i < knives.length; i++) knives[i].update(blades[i], dt);
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
