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

/* ── puntero y pinza ─────────────────────────────────────────────────────── */

/**
 * Mano con las cuatro landmarks que mira `getPointers`: muñeca (0), punta del
 * pulgar (4), punta del índice (8) y nudillo del medio (9).
 *
 * `span` es la distancia muñeca → nudillo, o sea el tamaño aparente de la mano;
 * `gap` la apertura de la pinza. El pinch es `gap / span`.
 */
function pinchHand({ gap, span = 0.3, cx = 0.5, cy = 0.5 }) {
  const pts = [];
  for (let i = 0; i < 21; i++) pts.push({ x: cx, y: cy });
  pts[0] = { x: cx, y: cy + span };     // muñeca
  pts[9] = { x: cx, y: cy };            // nudillo del medio
  pts[4] = { x: cx - gap / 2, y: cy };  // pulgar
  pts[8] = { x: cx + gap / 2, y: cy };  // índice
  return pts;
}

/**
 * Sostiene la misma mano varios frames para que el One Euro converja.
 *
 * Hace falta porque el puntero se mide sobre landmarks **suavizados**: un solo
 * frame deja el filtro a mitad de camino y el test estaría midiendo el filtro,
 * no la histéresis. Con 14 frames el error queda bajo 1e-4.
 */
function hold(pose, pts, frames = 14) {
  for (let i = 0; i < frames; i++) {
    hold.t = (hold.t || 1000) + 100;
    pose.pushFrame(hold.t, [pts], [label('Left')]);
  }
  return pose.getPointers()[0];
}

test('el puntero sale del medio de pulgar e índice, espejado', () => {
  const pose = createHandPose();
  // pinza centrada en (0.3, 0.3) de la imagen: espejada cae en (0.4, 0.4) de NDC
  const p = hold(pose, pinchHand({ gap: 0.2, cx: 0.3, cy: 0.3 }));
  expect(p.nx).toBeCloseTo(0.4, 3);
  expect(p.ny).toBeCloseTo(0.4, 3);

  // una mano a la izquierda de la imagen tiene que dar puntero a la derecha
  const q = hold(pose, pinchHand({ gap: 0.2, cx: 0.1, cy: 0.5 }));
  expect(q.nx).toBeGreaterThan(0);
});

test('el pinch tiene histéresis', () => {
  const pose = createHandPose();

  // cerrada por debajo de PINCH_ON (0.25): presiona
  expect(hold(pose, pinchHand({ gap: 0.06 })).pressed).toBe(true);

  /* Abrir hasta la banda intermedia (0.30) **no** suelta. Sin histéresis, un
     pinch sostenido al borde del umbral entra y sale varias veces por segundo y
     el trazo se corta solo. */
  const mid = hold(pose, pinchHand({ gap: 0.09 }));
  expect(mid.pinch).toBeGreaterThan(0.25);
  expect(mid.pinch).toBeLessThan(0.40);
  expect(mid.pressed).toBe(true);

  // pasando PINCH_OFF (0.40) sí suelta
  expect(hold(pose, pinchHand({ gap: 0.15 })).pressed).toBe(false);

  // y de vuelta en la banda intermedia sigue suelta: la histéresis va en los dos sentidos
  expect(hold(pose, pinchHand({ gap: 0.09 })).pressed).toBe(false);
});

test('el pinch se normaliza por el tamaño de la mano', () => {
  // la misma proporción de pinza, con la mano al doble de tamaño aparente
  const chica = hold(createHandPose(), pinchHand({ gap: 0.03, span: 0.15 }));
  const grande = hold(createHandPose(), pinchHand({ gap: 0.06, span: 0.30 }));

  expect(chica.pinch).toBeCloseTo(grande.pinch, 3);
  expect(chica.pressed).toBe(grande.pressed);
  expect(chica.pressed).toBe(true);

  // y la misma apertura absoluta con una mano grande no alcanza para cerrar
  const lejos = hold(createHandPose(), pinchHand({ gap: 0.15, span: 0.15 }));
  expect(lejos.pressed).toBe(false);
});

test('al perder la mano, el puntero desaparece y suelta la pinza', () => {
  const pose = createHandPose();
  expect(hold(pose, pinchHand({ gap: 0.05 })).pressed).toBe(true);

  const t = hold.t + LOST_AFTER_MS + 50;
  pose.pushFrame(t, [], []);
  expect(pose.getPointers()[0]).toBe(null);

  /* Al volver no puede aparecer ya presionada: la pinza se evalúa de nuevo
     desde cero. */
  const back = hold(pose, pinchHand({ gap: 0.30 }));
  expect(back.pressed).toBe(false);
});
