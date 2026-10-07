import { test, expect } from '@playwright/test';
import { createHandPose, LOST_AFTER_MS } from '../src/input/handPose.js';

/**
 * Unitarios de la lógica de tracking, en Node y sin navegador.
 *
 * handPose.js no toca el DOM ni MediaPipe justamente para que esto sea posible:
 * es donde vive todo lo que se puede romper en silencio.
 */

/** 21 landmarks con la muñeca (0) y el nudillo del índice (5) en su lugar. */
function hand(wristX, wristY, idxX = wristX, idxY = wristY - 0.1) {
  const pts = [];
  for (let i = 0; i < 21; i++) pts.push({ x: wristX, y: wristY });
  pts[0] = { x: wristX, y: wristY };
  pts[5] = { x: idxX, y: idxY };
  return pts;
}
const label = (name) => [{ categoryName: name }];
/** ndcToPlane de identidad: deja las aserciones en coordenadas predecibles. */
const identity = (nx, ny, out) => { out.x = nx; out.y = ny; return out; };
/** gx que produce getPoses con el ndcToPlane de identidad. */
const expectedGx = (wristX, idxX) => 1 - (wristX + idxX);

test('asigna los slots por handedness, no por el orden del array', () => {
  const pose = createHandPose();

  pose.pushFrame(0,
    [hand(0.2, 0.5), hand(0.8, 0.5)],
    [label('Left'), label('Right')]);
  const a = pose.getPoses(identity).map((p) => p && +p.gx.toFixed(3));

  // MediaPipe devuelve las mismas manos en el orden inverso
  pose.pushFrame(33,
    [hand(0.8, 0.5), hand(0.2, 0.5)],
    [label('Right'), label('Left')]);
  const b = pose.getPoses(identity).map((p) => p && +p.gx.toFixed(3));

  expect(b).toEqual(a);   // los cuchillos no se intercambian
  expect(a[0]).toBeCloseTo(expectedGx(0.2, 0.2), 3);   // slot 0 = izquierda
  expect(a[1]).toBeCloseTo(expectedGx(0.8, 0.8), 3);   // slot 1 = derecha
});

test('dos manos con la misma etiqueta no colapsan en un slot', () => {
  const pose = createHandPose();
  pose.pushFrame(0,
    [hand(0.2, 0.5), hand(0.8, 0.5)],
    [label('Right'), label('Right')]);
  const poses = pose.getPoses(identity);
  expect(poses[0]).not.toBeNull();
  expect(poses[1]).not.toBeNull();
  expect(poses[0].gx).not.toBeCloseTo(poses[1].gx, 2);
});

test('tolera una pérdida corta y suelta la mano recién pasado el timeout', () => {
  const pose = createHandPose();
  pose.pushFrame(0, [hand(0.5, 0.5)], [label('Right')]);
  expect(pose.getPoses(identity)[1]).not.toBeNull();

  // un hueco corto no debe hacer parpadear el cuchillo
  pose.pushFrame(LOST_AFTER_MS - 20, [], []);
  expect(pose.getPoses(identity)[1]).not.toBeNull();

  pose.pushFrame(LOST_AFTER_MS + 20, [], []);
  expect(pose.getPoses(identity)[1]).toBeNull();
});

test('al reaparecer, la pose no salta desde la posición vieja', () => {
  const pose = createHandPose();

  // la mano se queda quieta a la izquierda hasta que el filtro converge
  for (let t = 0; t <= 300; t += 33) pose.pushFrame(t, [hand(0.2, 0.5)], [label('Right')]);
  expect(pose.getPoses(identity)[1].gx).toBeCloseTo(expectedGx(0.2, 0.2), 2);

  // se pierde el tiempo suficiente como para darla por ida
  pose.pushFrame(600, [], []);
  expect(pose.getPoses(identity)[1]).toBeNull();

  // y reaparece del otro lado: el filtro tiene que arrancar de cero
  pose.pushFrame(633, [hand(0.8, 0.5)], [label('Right')]);
  const gx = pose.getPoses(identity)[1].gx;

  // sin el reset, One Euro mezclaría con la posición vieja y daría ~0.35 de
  // diferencia: ese era el bug de euro.reset() al pasar a dos manos
  expect(gx).toBeCloseTo(expectedGx(0.8, 0.8), 2);
});

test('la orientación sale del eje muñeca -> nudillo del índice', () => {
  const pose = createHandPose();
  // índice por encima de la muñeca en el encuadre (y menor) => hoja hacia arriba
  pose.pushFrame(0, [hand(0.5, 0.6, 0.5, 0.4)], [label('Right')]);
  const p = pose.getPoses(identity)[1];
  expect(p.dirx).toBeCloseTo(0, 3);
  expect(p.diry).toBeCloseTo(1, 3);
});

test('reset deja de reportar poses', () => {
  const pose = createHandPose();
  pose.pushFrame(0, [hand(0.5, 0.5)], [label('Right')]);
  expect(pose.getPoses(identity)[1]).not.toBeNull();
  pose.reset();
  expect(pose.getPoses(identity)[1]).toBeNull();
});
