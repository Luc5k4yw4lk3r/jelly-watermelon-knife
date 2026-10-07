import { createBlade } from '../input/blade.js';
import { createKnife } from '../render/knife.js';

/**
 * La mecánica original: el cuchillo sigue la mano (o el puntero) todo el tiempo,
 * lento empuja y rápido rebana.
 *
 * Esto es un traslado **literal** del loop que vivía en `main.js`. El orden de
 * las operaciones es el de antes: actualizar hoja, cortar, y recién después
 * colocar la malla del cuchillo. Si algo de acá cambia de comportamiento es un
 * bug, y `tests/behaviour.spec.js` existe justamente para probar que no cambió.
 */
export function createHandKnife({ view, cutter, onCut }) {
  // un cuchillo por mano: el tracking reporta hasta dos
  const hands = [createBlade(), createBlade()];
  const states = hands.map((h) => h.blade);     // el solver recibe los estados
  const knives = [
    createKnife(view.scene, view.camera, view),
    createKnife(view.scene, view.camera, view),
  ];

  function update(dt, io) {
    const { poses, source, rawDt, replayDt } = io;

    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      // en replay la velocidad usa el dt grabado: así el tajo es el que hizo la
      // mano, y no el que deja el framerate de la máquina que lo reproduce
      h.update(dt, poses[i] || null, source === 'replay' && replayDt ? replayDt : rawDt);

      // CORTE: una hoja rápida elimina todo resorte cuyo segmento cruce el área barrida
      if (h.shouldCut()) {
        const cut = cutter.cut(h.blade);
        if (cut.severed) onCut(cut, h.blade, knives[i]);
      }
    }

    for (let i = 0; i < knives.length; i++) knives[i].update(states[i], dt);
  }

  /* Al salir hay que apagar la hoja **ya**: si se la deja desvanecerse sola,
     queda colisionando con la gelatina mientras la otra mecánica la corta. */
  function exit() {
    for (let i = 0; i < states.length; i++) {
      const b = states[i];
      b.active = false;
      b.opacity = 0;
      b.speed = 0;
      knives[i].group.visible = false;
    }
  }

  /* El mouse orienta la hoja contra su posición del frame anterior, así que
     necesita el agarre de la hoja 0. Objeto reusado: el loop no asigna. */
  const _grip = { x: 0, y: 0 };
  function grip() {
    _grip.x = states[0].gx;
    _grip.y = states[0].gy;
    return _grip;
  }

  return {
    enter() {},                       // la hoja se re-engancha sola desde las poses
    exit,
    update,
    grip,
    get blades() { return states; },
    dispose() {
      exit();
      for (const k of knives) k.group.removeFromParent();
    },
  };
}
