import * as THREE from 'three';
import { tune } from '../../config.js';
import { createCleaver } from '../../render/cleaver.js';
import { createPusher } from '../../physics/impulse.js';
import { createLineKnifeFsm, IDLE, AIMING } from './fsm.js';
import { verticalCut } from './cutPlane.js';

/**
 * Mecánica «Cuchillo»: se dibuja una línea A→B sobre la fruta y una cuchilla de
 * carnicero baja y parte por el plano vertical que contiene esa línea.
 *
 * Es la contracara de la mecánica de tajo libre: no hay umbral de velocidad, así
 * que el corte cae exactamente donde se apuntó.
 *
 * El reparto de responsabilidades:
 *   `fsm.js`       los estados y los tiempos. Puro, testeable en Node.
 *   `cutPlane.js`  la base sintética y el quad. Puro, testeable en Node.
 *   este archivo   malla, guía, cruz, y traducir puntero → mundo.
 */
/** La cuchilla corta, no empuja: no entra en la colisión del solver. */
export function createLineKnife({ view, lat, shape, cutter, onCut, getPieces }) {
  const cleaver = createCleaver(view.scene);
  const pusher = createPusher(lat, shape);
  const fsm = createLineKnifeFsm();

  /* Línea guía. `depthTest:false` a propósito: tiene que leerse **sobre** la
     fruta, y a la altura del centro quedaría enterrada dentro de la gelatina. */
  const guideGeo = new THREE.BufferGeometry();
  guideGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const guide = new THREE.Line(guideGeo, new THREE.LineBasicMaterial({
    color: 0xd8324a, transparent: true, opacity: 0.9, depthTest: false,
  }));
  guide.renderOrder = 10;
  guide.frustumCulled = false;
  guide.visible = false;
  view.scene.add(guide);

  const cross = document.getElementById('cross');

  /* Base y hoja sintéticas del corte: se rellenan en el momento del tajo y se
     reusan, así que el loop no asigna. */
  const cutBasis = {
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, tx: 0, ty: 0, tz: 0,
  };
  const cutBlade = {
    x0: 0, y0: 0, x1: 0, y1: 0, px0: 0, py0: 0, px1: 0, py1: 0,
    dirx: 1, diry: 0, vx: 0, vy: 0,
  };

  /* El plano del corte, para que `onCut` pueda medir el reparto. Se reusa. */
  const cutPlane = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0 };

  const _g = new THREE.Vector3();
  const A = { x: 0, z: 0 }, B = { x: 0, z: 0 };
  const input = {
    pressed: false, x: 0, z: 0, lost: true, cancel: false,
    planeY: 0, centerY: 0, canCut: true,
  };

  /* La cámara de arranque mira el plano de apuntado casi de canto: está 0.46
     unidades por encima y a 4.5 de distancia, o sea ~6 grados. Sobre un plano
     visto así, mover el puntero un pixel desplaza el punto apuntado medio metro,
     y dibujar una línea es imposible. Al entrar a esta mecánica la cámara baja
     hasta mirar desde ~35 grados, con una transición para que no sea un salto.
     Si el usuario ya estaba mirando más desde arriba, no se la toca, y si orbita
     después, tampoco: el objetivo se suelta en cuanto se alcanza. */
  const AIM_POLAR = 0.95;
  let polarTarget = -1;

  let active = false;
  let owner = -1;              // slot que se quedó con el trazo
  let smX = 0, smZ = 0, haveSm = false;
  let opacity = 0;
  let lastState = IDLE;
  /* Lo último que se cortó, para `?dev`: sin esto, un trazo que corta poco y un
     trazo mal apuntado se ven igual desde afuera. */
  const lastCut = { ax: 0, az: 0, bx: 0, bz: 0, len: 0, severed: 0 };

  /* Esc cancela. Se consume en el update siguiente para que la cancelación
     entre por el mismo camino que el resto del input. */
  let cancelFlag = false;
  function onKey(e) {
    if (active && e.key === 'Escape') cancelFlag = true;
  }
  addEventListener('keydown', onKey);

  /**
   * Las dos manos emiten puntero y pinza. La primera que presiona se queda con
   * el trazo, y la otra se ignora hasta volver a IDLE: si no, dos manos
   * compitiendo mueven el punto B a los saltos.
   */
  function pick(pointers) {
    if (!pointers) return null;
    if (owner >= 0) {
      const held = pointers[owner];
      if (held) return held;
      if (fsm.state !== IDLE) return null;    // se perdió: que el FSM cancele
      owner = -1;
    }
    for (let i = 0; i < pointers.length; i++) {
      if (pointers[i] && pointers[i].pressed) { owner = i; return pointers[i]; }
    }
    for (let i = 0; i < pointers.length; i++) if (pointers[i]) return pointers[i];
    return null;
  }

  /** Altura del centro del pedazo más alto bajo la línea: ahí se dispara el corte. */
  function centerUnderLine() {
    const { N, pos } = lat;
    let dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-6)) return view.target.y;
    dx /= len; dz /= len;
    const m = tune.CUT_MARGIN;

    let lo = Infinity, hi = -Infinity;
    for (let p = 0; p < N; p++) {
      const o = p * 3;
      const ox = pos[o] - A.x, oz = pos[o + 2] - A.z;
      const along = ox * dx + oz * dz;
      if (along < -m || along > len + m) continue;
      const y = pos[o + 1];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    if (hi === -Infinity) return view.target.y;
    return (lo + hi) * 0.5;
  }

  function doCut() {
    const len = verticalCut(A, B, view.target.y, tune.CUT_MARGIN, cutBasis, cutBlade);
    if (!len) return;

    /* El jugo decide su dirección en coordenadas del plano de cámara, así que la
       caída de la hoja se expresa ahí: una velocidad de mundo (0,−v,0) proyectada
       sobre derecha/arriba de la cámara. */
    const v = 3.2;
    cutBlade.vx = -v * view.basis.ry;
    cutBlade.vy = -v * view.basis.uy;

    /* Una sola llamada, con el kerf desactivado. El kerf acota el barrido
       perpendicular al eje de la hoja para que un cuchillo que va de costado
       rebane en vez de excavar; la cuchilla baja **perpendicular a su propio
       filo**, así que con el kerf de siempre cortaría una banda de 8 cm y
       necesitaría decenas de frames seguidos para atravesar la fruta. */
    const cut = cutter.cut(cutBlade, {
      basis: cutBasis, kerf: Infinity, crossDepth: true, juiceBasis: view.basis,
    });
    if (!cut.severed) return;

    lastCut.ax = A.x; lastCut.az = A.z;
    lastCut.bx = B.x; lastCut.bz = B.z;
    lastCut.len = len; lastCut.severed = cut.severed;

    cutPlane.px = cutBasis.tx; cutPlane.py = cutBasis.ty; cutPlane.pz = cutBasis.tz;
    cutPlane.nx = cutBasis.fx; cutPlane.ny = cutBasis.fy; cutPlane.nz = cutBasis.fz;
    onCut(cut, cutBlade, cleaver, cutPlane);

    /* Después de `onCut`, que es quien reconstruye las componentes: antes,
       `compOf` todavía tendría los slots de antes del corte. */
    pusher.pushApart(A.x, view.target.y, A.z,
                     cutBasis.fx, cutBasis.fy, cutBasis.fz, tune.SEP_IMPULSE);
  }

  function update(dt, io) {
    if (polarTarget >= 0) {
      const d = polarTarget - view.polar;
      if (Math.abs(d) < 2e-3) polarTarget = -1;
      else view.orbit(0, d * Math.min(1, dt * 6));
    }

    const ptr = pick(io.pointers);

    if (ptr) {
      view.ndcToGround(ptr.nx, ptr.ny, view.target.y, _g);
      if (!haveSm) { smX = _g.x; smZ = _g.z; haveSm = true; }
      // la cuchilla sigue al puntero con suavizado, no pegada al píxel
      const k = 1 - Math.exp(-dt * 14);
      smX += (_g.x - smX) * k;
      smZ += (_g.z - smZ) * k;
    }

    /* El centro se muestrea **antes** de pisar el FSM, con la línea tal como va
       a quedar este frame: A es el que se fijó al presionar y B es el puntero de
       ahora. Muestrearlo después daría el centro de la línea del frame anterior,
       y en el frame del golpe esa es justo la que cambió. */
    const aiming = fsm.state === AIMING;
    if (aiming) { B.x = smX; B.z = smZ; } else { A.x = B.x = smX; A.z = B.z = smZ; }

    input.pressed = !!(ptr && ptr.pressed);
    input.lost = !ptr;
    input.cancel = cancelFlag;
    input.x = smX; input.z = smZ;
    input.planeY = view.target.y;
    input.centerY = aiming ? centerUnderLine() : view.target.y;
    input.canCut = getPieces() < tune.MAX_PIECES;
    cancelFlag = false;

    const r = fsm.update(dt * 1000, input);

    A.x = r.ax; A.z = r.az;
    B.x = r.bx; B.z = r.bz;

    if (r.cut) doCut();

    /* Guía fina de A a B, solo mientras se apunta. */
    const showGuide = r.state === AIMING && r.len > 0.02;
    guide.visible = showGuide;
    if (showGuide) {
      const a = guideGeo.attributes.position;
      a.setXYZ(0, r.ax, view.target.y, r.az);
      a.setXYZ(1, r.bx, view.target.y, r.bz);
      a.needsUpdate = true;
    }

    // aparece con un fundido, como el cuchillo de la otra mecánica
    const want = (ptr || r.state !== IDLE) ? 1 : 0;
    opacity += (want - opacity) * Math.min(1, dt * 7.5);

    // en espera A y B son el mismo punto, así que el punto medio sirve siempre
    const midX = (r.ax + r.bx) * 0.5, midZ = (r.az + r.bz) * 0.5;
    let dirX = r.bx - r.ax, dirZ = r.bz - r.az;
    if (Math.hypot(dirX, dirZ) < 1e-4) { dirX = 1; dirZ = 0; }

    cleaver.setPose(midX, r.bladeY, midZ, dirX, dirZ, r.align, opacity);
    cleaver.update(dt);

    if (cross) {
      cross.classList.toggle('on', !!ptr);
      cross.classList.toggle('pinch', input.pressed);
      if (ptr) {
        const px = (ptr.nx * 0.5 + 0.5) * innerWidth;
        const py = (0.5 - ptr.ny * 0.5) * innerHeight;
        cross.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
      }
    }

    lastState = r.state;
  }

  function enter() {
    active = true;
    owner = -1;
    haveSm = false;
    opacity = 0;
    fsm.enter(false);
    polarTarget = Math.min(view.polar, AIM_POLAR);
    /* La caja de sombra de siempre encuadra la sandía y el cuchillo; la cuchilla
       flota más alto y se saldría, justo cuando su sombra es lo que dice a qué
       altura está. */
    view.setShadowExtent(3.8);
  }

  function exit() {
    active = false;
    polarTarget = -1;
    fsm.enter(false);
    guide.visible = false;
    cleaver.hide();
    opacity = 0;
    if (cross) cross.classList.remove('on', 'pinch');
    view.setShadowExtent(2.6);
  }

  /**
   * Línea que se está apuntando, o null. La usa el modo práctica para mostrar
   * el reparto proyectado sin tener que cortar.
   */
  function aim() {
    if (fsm.state !== AIMING) return null;
    _aim.ax = A.x; _aim.az = A.z;
    _aim.bx = B.x; _aim.bz = B.z;
    _aim.y = view.target.y;
    return _aim;
  }
  const _aim = { ax: 0, az: 0, bx: 0, bz: 0, y: 0 };

  /**
   * Corta por una línea dada en coordenadas de mundo, sin gesto y sin animación.
   *
   * Es para `?dev` y para los tests: dibujar un trazo con el puntero se lleva
   * decenas de frames, y a 10 fps eso son segundos por corte. Lo que el gesto
   * prueba —que el puntero se traduce bien a una línea— lo cubre un test; todo
   * lo demás se puede probar con la línea puesta a mano, exacta y al instante.
   */
  function devCut(ax, az, bx, bz) {
    A.x = ax; A.z = az;
    B.x = bx; B.z = bz;
    doCut();
  }

  return {
    enter,
    exit,
    update,
    aim,
    devCut,
    get blades() { return NO_BLADES; },   // la cuchilla corta, no empuja
    devState: () => ({
      state: lastState, ax: A.x, az: A.z, bx: B.x, bz: B.z, lastCut,
    }),
    dispose() {
      exit();
      removeEventListener('keydown', onKey);
      cleaver.dispose();
      guide.removeFromParent();
      guideGeo.dispose();
      guide.material.dispose();
    },
  };
}

const NO_BLADES = [];
