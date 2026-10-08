import { test, expect } from '@playwright/test';
import { planarityOf } from '../src/physics/planarity.js';
import { createLattice } from '../src/physics/lattice.js';
import { createTopology } from '../src/physics/topology.js';
import { createCutter } from '../src/physics/cutting.js';
import { verticalCut } from '../src/mechanics/lineKnife/cutPlane.js';

/**
 * La métrica que decide la cara de corte, medida en Node.
 *
 * Vivía dentro de `devtools.js` y solo se podía correr en el navegador, que es
 * justo lo que hace cara una medición. Acá se comprueba primero que **distingue
 * el problema del no-problema** —una métrica que no lo hace cuesta más tiempo
 * que no medir— y recién después se anota la línea base.
 */

/* ── que la métrica discrimine ───────────────────────────────────────────── */

const idxs = (n) => Array.from({ length: n }, (_, i) => i);

test('una nube exactamente plana mide cero', () => {
  /* 25 puntos sobre el plano z = 0.3, en una grilla. Si esto no da cero, la
     métrica no sirve para decir que una cara quedó plana. */
  const pts = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) pts.push(i * 0.4, j * 0.4, 0.3);

  expect(planarityOf(pts, idxs(25))).toBe(0);
});

test('un escalón de media celda mide media celda', () => {
  /* El escalón de la lattice es lo que la métrica tiene que ver: una grilla con
     los puntos alternados a ±h de un plano da exactamente h. 0.091 es media
     celda, que es la amplitud del escalón.

     El escalón tiene que ser en **dos** dimensiones: un zigzag a lo largo de una
     recta está contenido en un plano, y la métrica —con razón— lo mide como
     plano. */
  const h = 0.091;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) pts.push(i * 0.2, j * 0.2, (i + j) % 2 ? h : -h);
  }

  expect(planarityOf(pts, idxs(36))).toBeCloseTo(h, 4);
});

/* ── la línea base, sobre la sandía de verdad ────────────────────────────── */

/** Una sandía en reposo exacto, su topología y su cutter. */
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

/** Corta por el plano vertical que contiene la línea A→B, como la cuchilla. */
function chop(ctx, a, b) {
  const basis = {};
  const blade = {};
  verticalCut(a, b, 0, 0.06, basis, blade);
  ctx.cutter.cut(blade, { basis, kerf: Infinity, crossDepth: true });
  ctx.topo.rebuild();
  return basis;
}

/** Las partículas de las caras de pulpa visibles: lo que mide la planaridad. */
function cutFaceParticles(ctx) {
  const { topo, lat } = ctx;
  const seen = new Set();
  for (let s = 0; s < topo.visCount; s++) {
    const f = topo.visFace[s];
    if (lat.faceKind[f] !== 1) continue;
    for (let v = 0; v < 4; v++) seen.add(lat.faceCorner[f * 4 + v]);
  }
  return [...seen];
}

test('línea base: la cara de un corte alineado mide el escalón de la lattice', () => {
  /* Determinista porque se mide sobre `rest`, y la sandía está en reposo exacto.
     Este número es contra el que se acepta o se revierte el recorte sub-celda:
     una cara realmente plana tiene que dar por debajo de 0.02. */
  const ctx = melon();
  chop(ctx, { x: 0, z: -1.5 }, { x: 0, z: 1.5 });

  const base = planarityOf(ctx.lat.rest, cutFaceParticles(ctx));
  console.log('línea base, corte alineado:', base);

  expect(base).toBeGreaterThan(0.05);
  expect(base).toBeLessThan(0.15);
});
