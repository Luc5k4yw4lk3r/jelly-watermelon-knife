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

import { sfx } from './audio/squish.js';
import { createHud } from './ui/hud.js';
import { createTuner } from './ui/tuner.js';

/* ── simulación ──────────────────────────────────────────────────────────── */

const lat = createLattice();
const topo = createTopology(lat);
const shape = createShapeMatcher(lat);
const solver = createSolver(lat, shape);
const cutter = createCutter(lat);

/* ── render ──────────────────────────────────────────────────────────────── */

const view = createScene(document.getElementById('gl'));
const jelly = createJellyMesh(lat, view.scene);
const knife = createKnife(view.scene, view.camera, view.knifeParallax);
const juice = createJuice(view.scene);

view.onResize.push(juice.setPixelScale);

/* ── entrada ─────────────────────────────────────────────────────────────── */

const { blade, update: updateBlade, shouldCut } = createBlade();
const mouse = createMouse();
const hand = createHandTracking({
  onStatus: ({ source, tracking }) => {
    if (source === 'hand') hud.setSource('Mano', true);
    if (tracking !== undefined) hud.setTracking(tracking);
  },
});

let source = 'none';   // 'hand' | 'mouse'

function useMouse() {
  source = 'mouse';
  hand.stop();
  hud.setSource('Mouse', false);
}

async function useCamera() {
  await hand.start();
  source = 'hand';
}

/* ── UI ──────────────────────────────────────────────────────────────────── */

const hud = createHud({
  onReset: reset,
  onUseCamera: () => { sfx.init(); return useCamera(); },
  onUseMouse: () => { sfx.init(); useMouse(); },
});

createTuner({ onStiffnessChange: lat.refreshStiffness });

function reset() {
  lat.reset();
  juice.clear();
  rebuildAfterTopologyChange();
  hud.toast('Sandía nueva');
}

/** El corte cambia la topología; todo lo que depende de ella se rehace acá. */
function rebuildAfterTopologyChange() {
  topo.rebuild();
  const pieces = shape.rebuild();
  jelly.rebuild(topo);
  hud.setPieces(pieces);
}

/* ── frame loop ──────────────────────────────────────────────────────────── */

let acc = 0, lastT = performance.now(), fpsEma = 60;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (!(dt > 0)) dt = DT;
  if (dt > 0.1) dt = 0.1;
  fpsEma += (1 / dt - fpsEma) * 0.08;

  if (view.adaptResolution(fpsEma)) fpsEma = 60;

  const pose = source === 'hand'
    ? hand.getPose(view.ndcToPlane)
    : (source === 'mouse' ? mouse.getPose(view.ndcToPlane, { x: blade.gx, y: blade.gy }) : null);
  updateBlade(dt, pose);

  // CORTE: una hoja rápida elimina todo resorte cuyo segmento cruce el área barrida
  if (shouldCut()) {
    const cut = cutter.cut(blade);
    if (cut.severed) {
      rebuildAfterTopologyChange();
      juice.burst(cut, blade);
      sfx.squish(cut.strength);
      knife.flash();
    }
  }

  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 3) { solver.step(DT, blade); acc -= DT; steps++; }
  if (acc > DT) acc = 0;

  knife.update(blade, dt);
  juice.update(dt);
  jelly.update(topo);
  jelly.material.uniforms.uTime.value = now * 0.001;

  view.render();
  hud.setFps(Math.round(fpsEma));
}

addEventListener('resize', view.resize);
view.resize();
rebuildAfterTopologyChange();
requestAnimationFrame(frame);
