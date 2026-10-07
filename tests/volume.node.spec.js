import { test, expect } from '@playwright/test';
import { RX, RY, RZ } from '../src/config.js';
import { createLattice } from '../src/physics/lattice.js';
import { createCutter } from '../src/physics/cutting.js';
import { createVolumeMeter, hexVolume, hexClip } from '../src/physics/volume.js';
import { createPieceTracker } from '../src/physics/pieces.js';
import { verticalCut } from '../src/mechanics/lineKnife/cutPlane.js';

/**
 * Medición del volumen, en Node y sin navegador.
 *
 * La geometría es lo que decide si el puntaje sirve, así que se prueba contra
 * figuras de respuesta conocida antes de confiar en lo que diga sobre la sandía.
 */

/* ── control: un cubo unitario ───────────────────────────────────────────── */

/** Las 8 esquinas del cubo unitario, en el orden que espera `hexVolume`. */
const CUBE = [
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
];
/** Distancias al plano x = t, por esquina. */
const atX = (t) => Array.from({ length: 8 }, (_, i) => CUBE[i * 3] - t);

test('el cubo de control mide 1', () => {
  expect(hexVolume(CUBE)).toBeCloseTo(1, 12);
});

test('un cubo cortado en x = t deja exactamente 1 − t de un lado', () => {
  /* Este es el control que valida el recorte de tetraedros. Si el reparto fuera
     por clasificación de celdas enteras, esto daría 0 o 1 y nada en el medio. */
  for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
    expect(hexClip(CUBE, atX(t))).toBeCloseTo(1 - t, 12);
  }
});

test('el recorte cubre los tres casos de la descomposición', () => {
  /* Un plano oblicuo deja tetraedros con 1, 2 y 3 vértices de cada lado. El caso
     de 2 contra 2 es una cuña y es el que más fácil se implementa mal, así que
     se comprueba contra la respuesta analítica. */
  const diag = (t) => Array.from({ length: 8 }, (_, i) =>
    (CUBE[i * 3] + CUBE[i * 3 + 1] + CUBE[i * 3 + 2]) / 3 - t);

  // plano x+y+z = 3t por el centro del cubo: parte exactamente a la mitad
  expect(hexClip(CUBE, diag(0.5))).toBeCloseTo(0.5, 12);
  // y por una esquina: el tetraedro de volumen (1/3)³/6 · 3³ = 1/6 … se verifica
  // contra la fórmula del simplex x+y+z > 2 → volumen 1/6
  expect(hexClip(CUBE, diag(2 / 3))).toBeCloseTo(1 / 6, 12);
  // la suma de los dos lados es siempre el total
  for (const t of [0.2, 0.37, 0.5, 0.8]) {
    const a = hexClip(CUBE, diag(t));
    const b = hexClip(CUBE, diag(t).map((d) => -d));
    expect(a + b).toBeCloseTo(1, 12);
  }
});

/* ── la sandía ───────────────────────────────────────────────────────────── */

function melon() {
  const lat = createLattice();
  lat.reset();
  const vm = createVolumeMeter(lat);
  const cutter = createCutter(lat, {
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, tx: 0, ty: 0, tz: 0,
  });
  const pieces = createPieceTracker(lat);
  pieces.reset();
  return { lat, vm, cutter, pieces };
}

function chop(ctx, a, b) {
  const basis = {}, blade = {};
  verticalCut(a, b, -0.12, 0.06, basis, blade);
  ctx.cutter.cut(blade, { basis, kerf: Infinity, crossDepth: true });
  return { basis, events: ctx.pieces.rebuild() };
}

test('las celdas suman casi el elipsoide analítico', () => {
  const { vm } = melon();
  const exact = (4 / 3) * Math.PI * RX * RY * RZ;
  /* Quedan ~1% abajo porque son hexaedros rectos inscritos en una superficie
     curva. Irrelevante para proporciones; importaría si se mostrara un volumen
     absoluto. */
  expect(vm.total).toBeGreaterThan(exact * 0.98);
  expect(vm.total).toBeLessThan(exact);
});

test('el reparto contra un plano tiene resolución por debajo de la celda', () => {
  const { vm } = melon();
  const pct = (t) => {
    const [a, b] = vm.splitByPlane(t, 0, 0, 1, 0, 0);
    return 100 * (1 - Math.abs(a - b) / (a + b));
  };

  /* Esta es la línea base, y la razón de recortar tetraedros en vez de clasificar
     celdas: una celda mide 0.182 de ancho, y entre 0 y media celda hay cuatro
     rangos distintos. Con celdas enteras, todo esto daría 100 hasta saltar
     de golpe a 78. */
  expect(pct(0)).toBeCloseTo(100, 6);
  expect(pct(0.010)).toBeGreaterThan(98);
  expect(pct(0.010)).toBeLessThan(99);
  expect(pct(0.020)).toBeGreaterThan(96);
  expect(pct(0.020)).toBeLessThan(97.5);
  expect(pct(0.045)).toBeGreaterThan(92);
  expect(pct(0.045)).toBeLessThan(94);
  expect(pct(0.090)).toBeGreaterThan(85);
  expect(pct(0.090)).toBeLessThan(88);

  // y es monótona: alejarse del centro siempre empeora
  let prev = Infinity;
  for (const t of [0, 0.01, 0.02, 0.045, 0.09, 0.135, 0.18, 0.27]) {
    const p = pct(t);
    expect(p).toBeLessThan(prev);
    prev = p;
  }
});

test('el reparto conserva el volumen, siempre', () => {
  const { vm } = melon();
  for (const t of [0, 0.03, 0.17, 0.5, 1.5]) {
    const [a, b] = vm.splitByPlane(t, 0, 0, 1, 0, 0);
    expect(a + b).toBeCloseTo(vm.total, 9);
  }
});

test('la suma de las piezas es el total, aunque el corte mate celdas', () => {
  /* Un tajo borra el 9% de las celdas. Repartir cada celda entre las piezas de
     sus 8 esquinas es lo que hace que no quede un agujero en la cuenta. */
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  const vols = ctx.vm.volumeOfPieces(ctx.pieces.label, ctx.pieces.nLabels);
  const sum = Array.from(vols).reduce((a, b) => a + b, 0);
  expect(ctx.pieces.nLabels).toBe(2);
  expect(sum).toBeCloseTo(ctx.vm.total, 9);
});

test('un tajo por el centro reparte mitad y mitad', () => {
  const ctx = melon();
  const { basis } = chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  const [a, b] = ctx.vm.splitByPlane(basis.tx, basis.ty, basis.tz, basis.fx, basis.fy, basis.fz);
  expect(100 * a / (a + b)).toBeCloseTo(50, 1);
});

test('un tajo descentrado se nota', () => {
  const ctx = melon();
  const { basis } = chop(ctx, { x: 0.36, z: -1.6 }, { x: 0.36, z: 1.6 });
  const [a, b] = ctx.vm.splitByPlane(basis.tx, basis.ty, basis.tz, basis.fx, basis.fy, basis.fz);
  const big = Math.max(a, b) / (a + b);
  expect(big).toBeGreaterThan(0.7);
});

test('recortar una mitad se mide contra esa mitad, no contra la sandía', () => {
  /* El puntaje es relativo a la pieza que se corta: partir una mitad por su
     propio centro tiene que dar 50/50, no 25/75. */
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });

  // la mitad de x > 0 y su centro aproximado
  const half = ctx.pieces.label[gidOfMaxX(ctx)];
  const w = ctx.vm.cellWeights(ctx.pieces.label, half);
  const vols = ctx.vm.volumeOfPieces(ctx.pieces.label, ctx.pieces.nLabels);

  const [a, b] = ctx.vm.splitByPlane(0.5, 0, 0, 1, 0, 0, w);
  expect(a + b).toBeCloseTo(vols[half], 9);     // el peso acota a esa mitad
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(0);
});

/** Partícula con el mayor x: sirve para identificar la mitad derecha. */
function gidOfMaxX(ctx) {
  const { N, pos } = ctx.lat;
  let best = 0;
  for (let p = 1; p < N; p++) if (pos[p * 3] > pos[best * 3]) best = p;
  return best;
}

/* ── identidad de las piezas ─────────────────────────────────────────────── */

test('un corte emite el split, con hijos nuevos y el padre que los parió', () => {
  const ctx = melon();
  expect(ctx.pieces.nLabels).toBe(1);
  const first = ctx.pieces.idOf[0];

  const { events } = chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  expect(events).toHaveLength(1);
  expect(events[0].parent).toBe(first);
  expect(events[0].children).toHaveLength(2);
  expect(events[0].children).not.toContain(first);
  expect(ctx.pieces.nLabels).toBe(2);
});

test('una pieza que no se toca conserva su id', () => {
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });

  // ids de la mitad izquierda antes del segundo corte, que es sobre la derecha
  const izq = ctx.lat.pos[0 * 3] < 0 ? ctx.pieces.idOf[0] : null;
  const antes = Array.from(ctx.pieces.idOf);

  const { events } = chop(ctx, { x: 0.45, z: -1.6 }, { x: 0.45, z: 1.6 });
  expect(events).toHaveLength(1);

  // toda partícula de una pieza no partida mantiene su id
  let intactas = 0;
  for (let p = 0; p < ctx.lat.N; p++) {
    if (ctx.lat.pos[p * 3] < 0) { expect(ctx.pieces.idOf[p]).toBe(antes[p]); intactas++; }
  }
  expect(intactas).toBeGreaterThan(100);
  if (izq !== null) expect(ctx.pieces.idOf[0]).toBe(izq);
});

test('reconstruir sin cortar no inventa eventos ni cambia ids', () => {
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.6 }, { x: 0, z: 1.6 });
  const antes = Array.from(ctx.pieces.idOf);

  expect(ctx.pieces.rebuild()).toHaveLength(0);
  expect(Array.from(ctx.pieces.idOf)).toEqual(antes);
});
