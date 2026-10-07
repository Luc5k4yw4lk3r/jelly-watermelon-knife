import { test, expect } from '@playwright/test';
import { createLattice } from '../src/physics/lattice.js';
import { createTopology } from '../src/physics/topology.js';
import { createCutter } from '../src/physics/cutting.js';
import { createCutGeometry } from '../src/physics/cutGeometry.js';
import { planarityOf } from '../src/physics/planarity.js';
import { verticalCut } from '../src/mechanics/lineKnife/cutPlane.js';
import { createShapeMatcher } from '../src/physics/shapeMatching.js';
import { createSolver } from '../src/physics/solver.js';
import { DT, RY, RZ, tune } from '../src/config.js';
import { createPusher } from '../src/physics/impulse.js';

/**
 * La geometría sub-celda de la cara de corte, medida sin navegador.
 *
 * Acá se decide la feature: si la planaridad no baja de la línea base hacia
 * <0.02, se revierte y se documenta con los números, como los dos intentos
 * anteriores. Que esto corra en Node es lo que permite saberlo **antes** de
 * escribir una línea de three.
 */

function melon() {
  const lat = createLattice();
  lat.reset();
  const topo = createTopology(lat);
  const cutter = createCutter(lat, {
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, tx: 0, ty: 0, tz: 0,
  });
  topo.rebuild();
  return { lat, topo, cutter };
}

/** Corta por el plano vertical que contiene A→B y devuelve ese plano. */
function chop(ctx, a, b) {
  const basis = {}, blade = {};
  verticalCut(a, b, 0, 0.06, basis, blade);
  ctx.cutter.cut(blade, { basis, kerf: Infinity, crossDepth: true });
  ctx.topo.rebuild();
  return {
    px: basis.tx, py: basis.ty, pz: basis.tz,
    nx: basis.fx, ny: basis.fy, nz: basis.fz,
  };
}

const idxs = (n) => Array.from({ length: n }, (_, i) => i);

test('la cara de un corte alineado queda sobre el plano', () => {
  /* La línea base del mismo corte, medida sobre las caras de celda, es 0.0735:
     media celda de escalón. La sección se construye sobre el plano, así que en
     reposo tiene que dar prácticamente cero.

     La cuenta de vértices no es decorativa: `planarityOf` devuelve 0 con menos
     de 4 puntos, así que sin esta aserción una sección vacía pasaría por
     perfectamente plana. */
  const ctx = melon();
  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });

  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);
  const pts = geo.sectionRest();

  expect(pts.length / 3).toBeGreaterThan(100);
  expect(planarityOf(pts, idxs(pts.length / 3))).toBeLessThan(0.02);
});

test('la cara sigue plana con la sandía deformada', () => {
  /* El riesgo real de la técnica: los `t` se eligen sobre las posiciones
     deformadas y después se interpolan sobre las de reposo. Con la fruta
     asentada —que es como se juega— las dos no coinciden, así que la sección no
     tiene por qué caer exactamente sobre el plano en reposo.
     Este es el número contra el que se acepta o se revierte. */
  const ctx = melon();
  const shape = createShapeMatcher(ctx.lat);
  shape.rebuild();
  const solver = createSolver(ctx.lat, shape, {
    rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, tx: 0, ty: 0, tz: 0,
  });
  for (let i = 0; i < 120; i++) solver.step(DT, []);

  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);
  const pts = geo.sectionRest();
  const rms = planarityOf(pts, idxs(pts.length / 3));
  console.log('planaridad con la fruta asentada:', rms, '| vértices:', pts.length / 3);

  expect(pts.length / 3).toBeGreaterThan(100);
  expect(rms).toBeLessThan(0.02);
});

test('la sección cubre la elipse entera, no un parche', () => {
  /* La planaridad sola es casi tautológica: la sección se construye sobre el
     plano, así que *tiene* que dar plana. Lo que no puede es faltar, sobrar ni
     estar doblada, y eso lo mide el área: un corte por el centro de un
     elipsoide es una elipse de semiejes RY y RZ. */
  const ctx = melon();
  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);

  let area = 0;
  for (let p = 0; p < geo.nPoly; p++) {
    if (geo.polySide[p] < 0 || !geo.polyIsSection[p]) continue;   // un lado, y sin paredes
    area += polyArea(geo, p);
  }
  const elipse = Math.PI * RY * RZ;
  console.log('área de la sección:', area.toFixed(4), '| elipse analítica:', elipse.toFixed(4));

  // las celdas son hexaedros rectos inscritos en una superficie curva: faltan ~1%
  expect(area).toBeGreaterThan(elipse * 0.9);
  expect(area).toBeLessThan(elipse * 1.02);
});

/** Área del polígono `p` de la sección, por la fórmula de Newell en reposo. */
function polyArea(geo, p, pts = geo.vRest) {
  const s = geo.polyStart[p], n = geo.polyLen[p];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = (s + i) * 3, b = (s + (i + 1) % n) * 3;
    nx += pts[a + 1] * pts[b + 2] - pts[a + 2] * pts[b + 1];
    ny += pts[a + 2] * pts[b]     - pts[a]     * pts[b + 2];
    nz += pts[a]     * pts[b + 1] - pts[a + 1] * pts[b];
  }
  return Math.hypot(nx, ny, nz) / 2;
}

test('cada mitad se lleva su cara: la sección no se estira entre las dos', () => {
  /* El modo de falla que define el diseño. Un vértice de la sección vive sobre
     una arista cuyas dos puntas quedaron en **piezas distintas**: interpolando
     `pos` crudo, la cara se estira como una membrana en cuanto las mitades se
     separan —y se separan, porque el impulso viaja 122 veces su tamaño—.

     Anclada a la partícula de su propio lado, cada mitad se lleva su media
     cara: las dos secciones se despegan uua de otra y ninguna crece. */
  const ctx = melon();
  const shape = createShapeMatcher(ctx.lat);
  shape.rebuild();
  const basis = { rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: -1, tx: 0, ty: 0, tz: 0 };
  const solver = createSolver(ctx.lat, shape, basis);
  for (let i = 0; i < 120; i++) solver.step(DT, []);

  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);
  shape.rebuild();

  const areaAntes = sideArea(geo, +1);

  // separar las mitades, como hace la cuchilla después de cortar
  createPusher(ctx.lat, shape).pushApart(
    plane.px, plane.py, plane.pz, plane.nx, plane.ny, plane.nz, tune.SEP_IMPULSE);
  for (let i = 0; i < 90; i++) solver.step(DT, []);
  geo.update(shape);

  const sep = Math.abs(sideCentroid(geo, +1)[0] - sideCentroid(geo, -1)[0]);
  const areaDespues = sideArea(geo, +1, geo.vPos);
  console.log('separación de las dos caras:', sep.toFixed(3),
              '| área antes', areaAntes.toFixed(3), '→ después', areaDespues.toFixed(3));

  // las dos caras se despegaron de verdad
  expect(sep).toBeGreaterThan(0.08);
  // y ninguna se estiró para alcanzar a la otra
  expect(areaDespues).toBeLessThan(areaAntes * 1.3);
});

/** Área de las secciones de un lado, en reposo o en las posiciones que se pasen. */
function sideArea(geo, side, pts = geo.vRest) {
  let a = 0;
  for (let p = 0; p < geo.nPoly; p++) {
    if (geo.polySide[p] === side && geo.polyIsSection[p]) a += polyArea(geo, p, pts);
  }
  return a;
}

/** Centroide de las secciones de un lado, en posiciones deformadas. */
function sideCentroid(geo, side) {
  let x = 0, y = 0, z = 0, n = 0;
  for (let p = 0; p < geo.nPoly; p++) {
    if (geo.polySide[p] !== side || !geo.polyIsSection[p]) continue;
    for (let i = 0; i < geo.polyLen[p]; i++) {
      const o = (geo.polyStart[p] + i) * 3;
      x += geo.vPos[o]; y += geo.vPos[o + 1]; z += geo.vPos[o + 2]; n++;
    }
  }
  return [x / n, y / n, z / n];
}

test('el remanente de la celda llega hasta el plano, también por la cáscara', () => {
  /* Con la sección sola, la cara plana queda flotando: el tajo se comió una capa
     de celdas y entre la fruta que quedó y el plano no hay nada. Las paredes de
     la celda muerta, recortadas, son las que cierran ese hueco — y la de afuera
     va como corteza, que es lo que hace que el verde llegue hasta el plano. */
  const ctx = melon();
  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);

  let paredes = 0, corteza = 0, tocanElPlano = 0;
  for (let p = 0; p < geo.nPoly; p++) {
    if (geo.polyIsSection[p]) continue;
    paredes++;
    if (geo.polyKind[p] === 0) corteza++;
    for (let i = 0; i < geo.polyLen[p]; i++) {
      // el plano es x = 0: un vértice sobre él cierra contra la sección
      if (Math.abs(geo.vRest[(geo.polyStart[p] + i) * 3]) < 1e-6) tocanElPlano++;
    }
  }
  console.log('paredes:', paredes, '| de corteza:', corteza, '| vértices sobre el plano:', tocanElPlano);

  expect(paredes).toBeGreaterThan(0);
  expect(corteza).toBeGreaterThan(0);
  expect(tocanElPlano).toBeGreaterThan(0);
});

test('la sección cae sobre el plano, no cerca', () => {
  /* Más filoso que la planaridad: el RMS mide contra el plano de mejor ajuste,
     así que una sección entera corrida —o construida con los restos de otro
     recorte— puede salir plana y estar en otro lado. Esto mide contra el plano
     del corte, que es el único que vale. */
  const ctx = melon();
  const plane = chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });
  const geo = createCutGeometry(ctx.lat);
  geo.rebuild(plane, ctx.topo);

  let max = 0;
  for (let p = 0; p < geo.nPoly; p++) {
    if (!geo.polyIsSection[p]) continue;
    for (let i = 0; i < geo.polyLen[p]; i++) {
      const o = (geo.polyStart[p] + i) * 3;
      const d = (geo.vRest[o] - plane.px) * plane.nx
              + (geo.vRest[o + 1] - plane.py) * plane.ny
              + (geo.vRest[o + 2] - plane.pz) * plane.nz;
      max = Math.max(max, Math.abs(d));
    }
  }
  expect(max).toBeLessThan(1e-9);
});
