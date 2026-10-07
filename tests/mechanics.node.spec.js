import { test, expect } from '@playwright/test';
import { tune, tuneDefaults, FLOOR_Y } from '../src/config.js';
import { createLattice } from '../src/physics/lattice.js';
import { createShapeMatcher } from '../src/physics/shapeMatching.js';
import { createCutter } from '../src/physics/cutting.js';
import { createPusher } from '../src/physics/impulse.js';
import { createLineKnifeFsm, IDLE, AIMING, STRIKING, RETRACTING }
  from '../src/mechanics/lineKnife/fsm.js';
import { verticalCut } from '../src/mechanics/lineKnife/cutPlane.js';

/**
 * Unitarios de la mecánica «Cuchillo», en Node y sin navegador.
 *
 * La máquina de estados y la geometría del plano son puras a propósito, igual
 * que `handPose`: es donde está todo lo que se puede romper en silencio. Y como
 * la lattice y el cutter tampoco tocan el DOM, el **corte de verdad** también se
 * puede probar acá, en segundos y sin depender de cuántos frames caigan.
 */

test.beforeEach(() => { Object.assign(tune, tuneDefaults); });

/* ── máquina de estados ──────────────────────────────────────────────────── */

const PLANE_Y = -0.12;

/** Input del FSM con los valores por defecto; se pisa lo que haga falta. */
function at(over = {}) {
  return {
    pressed: false, x: 0, z: 0, lost: false, cancel: false,
    planeY: PLANE_Y, centerY: PLANE_Y, canCut: true,
    ...over,
  };
}

/** Corre el FSM hasta volver a IDLE, contando los cortes que pidió. */
function runToIdle(fsm, input, maxFrames = 400) {
  let cuts = 0, frames = 0, last;
  do {
    last = fsm.update(16, input);
    if (last.cut) cuts++;
  } while (last.state !== IDLE && ++frames < maxFrames);
  return { cuts, frames, last };
}

test('el ciclo completo pide un solo corte', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);

  expect(fsm.update(16, at()).state).toBe(IDLE);

  // presionar fija A
  expect(fsm.update(16, at({ pressed: true })).state).toBe(AIMING);
  // arrastrar mueve B
  const aiming = fsm.update(16, at({ pressed: true, x: 1.2 }));
  expect(aiming.state).toBe(AIMING);
  expect(aiming.len).toBeCloseTo(1.2, 2);

  // soltar con una línea larga arranca el golpe
  expect(fsm.update(16, at({ x: 1.2 })).state).toBe(STRIKING);

  const { cuts, last } = runToIdle(fsm, at({ x: 1.2 }));
  expect(cuts).toBe(1);
  expect(last.state).toBe(IDLE);
});

test('la hoja baja, atraviesa el piso y vuelve a subir', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  const hover = fsm.update(16, at({ pressed: true, x: 1.2 })).bladeY;
  expect(hover).toBeCloseTo(PLANE_Y + tune.HOVER_H, 5);

  fsm.update(16, at({ x: 1.2 }));
  let min = Infinity, sawRetract = false;
  for (let i = 0; i < 400; i++) {
    const r = fsm.update(16, at({ x: 1.2 }));
    min = Math.min(min, r.bladeY);
    if (r.state === RETRACTING) sawRetract = true;
    if (sawRetract && r.state === IDLE) break;
  }
  expect(min).toBeLessThan(FLOOR_Y);    // tiene que pasar el piso
  expect(sawRetract).toBe(true);
});

test('Esc cancela el apuntado', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));

  const r = fsm.update(16, at({ pressed: true, x: 1.2, cancel: true }));
  expect(r.state).toBe(IDLE);
  expect(r.cut).toBe(false);

  // y soltar después no dispara nada
  expect(runToIdle(fsm, at({ x: 1.2 })).cuts).toBe(0);
});

test('perder la mano cancela el apuntado', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));

  const r = fsm.update(16, at({ lost: true, x: 1.2 }));
  expect(r.state).toBe(IDLE);
  expect(r.cut).toBe(false);
});

test('una línea más corta que el mínimo no corta', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  const short = tune.MIN_CUT_LEN * 0.5;
  fsm.update(16, at({ pressed: true, x: short }));

  const r = fsm.update(16, at({ x: short }));
  expect(r.state).toBe(IDLE);
  expect(runToIdle(fsm, at({ x: short })).cuts).toBe(0);
});

test('el input nuevo no interrumpe el golpe', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));
  expect(fsm.update(16, at({ x: 1.2 })).state).toBe(STRIKING);

  /* Apretar de nuevo mientras baja y mientras sube no puede abrir un trazo: se
     encola a lo sumo un corte, y ese ya está pedido. */
  let cuts = 0, aimings = 0;
  for (let i = 0; i < 400; i++) {
    const r = fsm.update(16, at({ pressed: true, x: 2.4 }));
    if (r.cut) cuts++;
    if (r.state === AIMING) aimings++;
    if (r.state === IDLE) break;
  }
  expect(cuts).toBe(1);
  expect(aimings).toBe(0);
});

test('entrar a la mecánica con el botón ya apretado no abre un trazo', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(true);     // se cambió de mecánica con el botón apretado
  expect(fsm.update(16, at({ pressed: true, x: 1.2 })).state).toBe(IDLE);
  expect(fsm.update(16, at({ pressed: true, x: 1.2 })).state).toBe(IDLE);
  // recién después de soltar y volver a apretar
  fsm.update(16, at({ x: 1.2 }));
  expect(fsm.update(16, at({ pressed: true, x: 1.2 })).state).toBe(AIMING);
});

test('el corte se dispara por cruce, y pasa mientras la hoja está en la fruta', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));
  fsm.update(16, at({ x: 1.2 }));

  /* Con cuatro frames de golpe, la hoja recorre ~0.7 unidades por frame: nunca
     cae "cerca" del centro, lo pasa de largo. Un disparo por cercanía solo
     alcanzaría a cortar al final de la animación, con la hoja ya debajo del
     piso — visualmente, la sandía se partiría después de que el cuchillo salió.
     El cruce corta con la hoja todavía adentro de la fruta. */
  let cutY = null, cuts = 0;
  for (let i = 0; i < 8; i++) {
    const r = fsm.update(tune.STRIKE_MS / 4, at({ x: 1.2 }));
    if (r.cut) { cuts++; cutY = r.bladeY; }
    if (r.state === IDLE) break;
  }
  expect(cuts).toBe(1);
  expect(cutY).not.toBe(null);
  expect(cutY).toBeGreaterThan(FLOOR_Y);
});

test('ni con un frame enorme se pierde el corte', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));
  fsm.update(16, at({ x: 1.2 }));

  /* El navegador de los tests renderiza por software: un solo frame puede llevar
     la hoja de arriba de la fruta a abajo del piso. Ahí el corte se cobra igual,
     aunque llegue tarde. */
  const r = fsm.update(tune.STRIKE_MS * 3, at({ x: 1.2 }));
  expect(r.cut).toBe(true);
  expect(r.bladeY).toBeLessThan(FLOOR_Y);
});

test('el límite de piezas veta el corte', () => {
  const fsm = createLineKnifeFsm();
  fsm.enter(false);
  fsm.update(16, at({ pressed: true }));
  fsm.update(16, at({ pressed: true, x: 1.2 }));
  fsm.update(16, at({ x: 1.2 }));

  // el golpe se anima igual, pero no corta
  const { cuts, last } = runToIdle(fsm, at({ x: 1.2, canCut: false }));
  expect(cuts).toBe(0);
  expect(last.state).toBe(IDLE);
});

/* ── geometría del plano ─────────────────────────────────────────────────── */

const basisOf = (a, b, margin = 0.06) => {
  const basis = {}, blade = {};
  const len = verticalCut(a, b, PLANE_Y, margin, basis, blade);
  return { basis, blade, len };
};
/** Distancia con signo de un punto al plano de corte. */
const toPlane = (basis, x, y, z) =>
  (x - basis.tx) * basis.fx + (y - basis.ty) * basis.fy + (z - basis.tz) * basis.fz;

test('el plano de corte contiene AB y es vertical', () => {
  const a = { x: -0.4, z: 0.7 }, b = { x: 0.9, z: -0.3 };
  const { basis, len } = basisOf(a, b);

  expect(len).toBeCloseTo(Math.hypot(b.x - a.x, b.z - a.z), 6);

  // la normal del plano es horizontal: el plano es vertical
  expect(basis.fy).toBe(0);
  expect(Math.hypot(basis.fx, basis.fz)).toBeCloseTo(1, 6);

  // A y B están sobre el plano, a cualquier altura
  expect(toPlane(basis, a.x, PLANE_Y, a.z)).toBeCloseTo(0, 9);
  expect(toPlane(basis, b.x, PLANE_Y, b.z)).toBeCloseTo(0, 9);
  expect(toPlane(basis, b.x, 5.0, b.z)).toBeCloseTo(0, 9);

  // base ortonormal
  const dot = (ax, ay, az, bx, by, bz) => ax * bx + ay * by + az * bz;
  expect(dot(basis.rx, basis.ry, basis.rz, basis.ux, basis.uy, basis.uz)).toBeCloseTo(0, 9);
  expect(dot(basis.rx, basis.ry, basis.rz, basis.fx, basis.fy, basis.fz)).toBeCloseTo(0, 9);
  expect(dot(basis.ux, basis.uy, basis.uz, basis.fx, basis.fy, basis.fz)).toBeCloseTo(0, 9);
  expect(Math.hypot(basis.rx, basis.ry, basis.rz)).toBeCloseTo(1, 9);
});

/* ── el corte de verdad, sobre la lattice ────────────────────────────────── */

function melon() {
  const lat = createLattice();
  lat.reset();
  const shape = createShapeMatcher(lat);
  // la base de "cámara" del cutter no se usa: cada corte pasa la suya
  const cutter = createCutter(lat, {
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, tx: 0, ty: 0, tz: 0,
  });
  shape.rebuild();
  return { lat, shape, cutter };
}

function chop(ctx, a, b) {
  const { basis, blade } = basisOf(a, b);
  const before = Uint8Array.from(ctx.lat.sprAlive);
  const cut = ctx.cutter.cut(blade, { basis, kerf: Infinity, crossDepth: true });
  return { cut, basis, before };
}

test('un tajo vertical por el medio parte la sandía en dos', () => {
  const ctx = melon();
  // línea sobre Z en x = 0: el plano de corte es x = 0
  const { cut } = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });

  expect(cut.severed).toBeGreaterThan(100);
  expect(ctx.shape.rebuild()).toBe(2);
});

test('el corte cubre la fruta entera, flote donde flote la cuchilla', () => {
  /* La altura de espera es puesta en escena: encuadra mejor o peor, pero no
     puede decidir hasta dónde llega el corte. Cuando el techo del quad colgaba
     de ella, bajarla dejaba las mitades unidas por un puente de resortes arriba
     de todo: se veía partida y seguía siendo una sola pieza. */
  tune.HOVER_H = 0.2;
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  expect(ctx.shape.rebuild()).toBe(2);
});

test('cada mitad se puede volver a cortar', () => {
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  expect(ctx.shape.rebuild()).toBe(2);

  // perpendicular al primero: las dos mitades se parten
  chop(ctx, { x: -1.6, z: 0 }, { x: 1.6, z: 0 });
  expect(ctx.shape.rebuild()).toBe(4);

  // y un tercero sobre una sola de las columnas
  chop(ctx, { x: 0.45, z: -1.6 }, { x: 0.45, z: 1.6 });
  expect(ctx.shape.rebuild()).toBe(6);
});

test('el corte no es un plano infinito: más allá de B no se toca nada', () => {
  const ctx = melon();
  const { lat } = ctx;

  /* Media línea: de z = −1.5 hasta z = 0. Todo resorte con sus dos extremos en
     z > margen tiene que seguir vivo, y la sandía **no** se separa. */
  const { cut, before } = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 0 });
  expect(cut.severed).toBeGreaterThan(20);

  const limit = tune.CUT_MARGIN;
  let cortadosAfuera = 0;
  for (let m = 0; m < lat.M; m++) {
    if (!before[m] || lat.sprAlive[m]) continue;         // no se cortó ahora
    const za = lat.pos[lat.sprA[m] * 3 + 2];
    const zb = lat.pos[lat.sprB[m] * 3 + 2];
    if (za > limit && zb > limit) cortadosAfuera++;
  }
  expect(cortadosAfuera).toBe(0);
  expect(ctx.shape.rebuild()).toBe(1);                   // sigue de una pieza
});

test('las mitades reciben el empujón en sentidos opuestos', () => {
  const ctx = melon();
  const { lat, shape } = ctx;
  const { basis } = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  expect(shape.rebuild()).toBe(2);

  const pusher = createPusher(lat, shape);
  const prevBefore = Float32Array.from(lat.prev);
  const posBefore = Float32Array.from(lat.pos);

  const pushed = pusher.pushApart(0, PLANE_Y, 0, basis.fx, basis.fy, basis.fz, tune.SEP_IMPULSE);
  expect(pushed).toBe(2);

  // `pos` no se toca: la velocidad es implícita en pos - prev
  expect(Array.from(lat.pos)).toEqual(Array.from(posBefore));

  /* La velocidad que gana cada partícula tiene el signo del lado en que quedó su
     pedazo. Con el plano en x = 0 y la normal sobre x, eso es el signo de x. */
  let der = 0, izq = 0;
  for (let p = 0; p < lat.N; p++) {
    const o = p * 3;
    const dv = -(lat.prev[o] - prevBefore[o]);     // velocidad agregada en x
    if (Math.abs(dv) < 1e-9) continue;
    if (lat.pos[o] > 0) { expect(dv).toBeGreaterThan(0); der++; }
    else { expect(dv).toBeLessThan(0); izq++; }
  }
  expect(der).toBeGreaterThan(100);
  expect(izq).toBeGreaterThan(100);

  // y el empujón no puede pasarse del tope por paso del solver
  expect(tune.SEP_IMPULSE).toBeLessThan(0.09);
});
