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

import { sfx } from './audio/squish.js';
import { createHud } from './ui/hud.js';
import { createTuner } from './ui/tuner.js';

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
  orbit.update(dt);

  let poses;
  if (source === 'hand') {
    poses = hand.getPoses(view.ndcToPlane);
  } else {
    mousePoses[0] = source === 'mouse'
      ? mouse.getPose(view.ndcToPlane, { x: blades[0].gx, y: blades[0].gy })
      : null;
    poses = mousePoses;   // el mouse maneja un solo cuchillo
  }

  for (let i = 0; i < hands.length; i++) {
    const h = hands[i];
    h.update(dt, poses[i] || null);

    // CORTE: una hoja rápida elimina todo resorte cuyo segmento cruce el área barrida
    if (h.shouldCut()) {
      const cut = cutter.cut(h.blade);
      if (cut.severed) {
        rebuildAfterTopologyChange();
        juice.burst(cut, h.blade);
        sfx.squish(cut.strength);
        knives[i].flash();
      }
    }
  }

  acc += dt;
  let steps = 0;
  while (acc >= DT && steps < 3) { solver.step(DT, blades); acc -= DT; steps++; }
  if (acc > DT) acc = 0;

  for (let i = 0; i < knives.length; i++) knives[i].update(blades[i], dt);
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
