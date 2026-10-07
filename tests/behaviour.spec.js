import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * El contrato de interacción, contra el build real.
 *
 * Esto es lo que no cubría nada: que un arrastre lento empuje y un tajo rápido
 * corte es la regla central del juego, y se rompe con un cambio de constante o
 * con cualquier cosa que toque la base de cámara.
 */

function problems(page) {
  const found = [];
  page.on('console', (m) => { if (m.type() === 'error') found.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => found.push(`pageerror: ${e.message}`));
  return found;
}

/** Arranca en modo mouse, que no pide permisos de cámara. */
async function boot(page, query = '?dev') {
  await page.goto('/' + query);
  await page.locator('#btnMouse').click();
  await expect(page.locator('#overlay')).toBeHidden();
  await page.waitForTimeout(1500);        // que la sandía se asiente
}

/**
 * Altura visible en el plano de corte: con fov 40 y radio de órbita 4.474 son
 * 2 * tan(20°) * 4.474 unidades de mundo. Convierte píxeles a mundo.
 */
const VISIBLE_WORLD_HEIGHT = 2 * Math.tan((40 / 2) * Math.PI / 180) * 4.474;
const WARM_MS = 500;
const SLASH = { worldPerSec: 6, worldDistance: 5.0 };   // CUT_SPEED es 4 u/s

/**
 * Barre el puntero a una velocidad dada **en unidades de mundo por segundo**.
 *
 * Dos detalles que hacen que esto sirva:
 *
 * 1. La velocidad va en unidades de mundo por segundo, no en píxeles por frame.
 *    El umbral de corte está en esas unidades, y el navegador de CI renderiza
 *    por software a bastante menos de 60 fps: en píxeles por frame el mismo
 *    gesto da velocidades distintas según la máquina.
 * 2. Arranca lento sobre la misma dirección antes de acelerar. Una hoja que
 *    recién aparece reporta `rot = PI` (el centinela de "recién reacquirida") y
 *    la guarda de rotación veta el corte esos frames; sin el arranque, un tajo
 *    corto se consume entero en el veto. La velocidad del arranque queda debajo
 *    del umbral, así que no corta.
 */
async function swipe(page, { fromX, fromY, dirX, dirY, worldPerSec, worldDistance }) {
  const { height } = page.viewportSize();
  const pxPerWorld = height / VISIBLE_WORLD_HEIGHT;
  await page.evaluate(async (o) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const move = (x, y) => dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    const len = Math.hypot(o.dirX, o.dirY) || 1;
    const ux = o.dirX / len, uy = o.dirY / len;

    let d = 0;
    move(o.fromX, o.fromY); await raf();
    const warm = performance.now();
    while (performance.now() - warm < o.warmMs) {
      d = ((performance.now() - warm) / 1000) * o.warmPxPerSec;
      move(o.fromX + ux * d, o.fromY + uy * d);
      await raf();
    }

    const base = d, t0 = performance.now();
    for (;;) {
      d = base + Math.min(o.distancePx, ((performance.now() - t0) / 1000) * o.pxPerSec);
      move(o.fromX + ux * d, o.fromY + uy * d);
      if (d - base >= o.distancePx) break;
      await raf();
    }
  }, {
    fromX, fromY, dirX, dirY,
    warmMs: WARM_MS,
    warmPxPerSec: 1.0 * pxPerWorld,          // debajo del umbral de corte
    pxPerSec: worldPerSec * pxPerWorld,
    distancePx: worldDistance * pxPerWorld,
  });
  await page.waitForTimeout(1400);
}

const pieces = (page) => page.locator('#pieces').innerText();
const cuts = (page) => page.evaluate(() => window.__dev.cuts);
const slashDown = (page) => {
  const { width } = page.viewportSize();
  return swipe(page, { fromX: width / 2, fromY: 40, dirX: 0, dirY: 1, ...SLASH });
};

/**
 * Corre el tajo grabado, reproduciendo landmarks en lugar de la cámara.
 *
 * Es determinista: el replay avanza un frame grabado por frame renderizado y la
 * velocidad de la hoja usa el dt grabado, así que da exactamente el mismo corte
 * en cualquier máquina. Los barridos de mouse dependen de cuántos frames caigan
 * —el navegador de CI renderiza por software a pocos fps— y por eso no sirven
 * para afirmar resultados exactos ni para medir.
 */
async function runReplay(page, duringWarmUp) {
  await page.route(
    (url) => url.pathname.endsWith('/landmarks-fixture.json'),
    (route) => route.fulfill({
      path: fileURLToPath(new URL('./fixtures/slash-synthetic.json', import.meta.url)),
      contentType: 'application/json',
    }));
  await page.goto('/?dev&replay=landmarks-fixture.json');
  await expect(page.locator('#overlay')).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('#srcLabel')).toHaveText('Replay');
  // el fixture arranca con varios frames lentos, así que hay margen para hacer
  // algo (girar la cámara, por ejemplo) antes de que llegue el tajo
  if (duringWarmUp) await duringWarmUp();
  await expect.poll(() => page.evaluate(() => window.__dev.replay.done), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(1200);
}

test('un arrastre lento empuja, no corta', async ({ page }) => {
  const errs = problems(page);
  await boot(page);
  const { width, height } = page.viewportSize();

  await swipe(page, { fromX: width / 2 - 330, fromY: height / 2,
                      dirX: 1, dirY: 0, worldPerSec: 2.0, worldDistance: 3.0 });

  // la afirmación precisa no es "quedó entera" sino "no cortó nada"
  expect((await cuts(page)).events).toBe(0);
  expect(await pieces(page)).toBe('1');
  expect(errs).toEqual([]);
});

test('un tajo rápido corta', async ({ page }) => {
  const errs = problems(page);
  await boot(page);

  await slashDown(page);

  const c = await cuts(page);
  expect(c.events).toBeGreaterThan(0);
  expect(c.severed).toBeGreaterThan(100);
  expect(errs).toEqual([]);
});

test('el tajo grabado separa la sandía', async ({ page }) => {
  await runReplay(page);

  expect(await pieces(page)).toBe('2');
  /* El replay fija la **entrada**, no la simulación: la física avanza por pasos
     fijos acumulados contra tiempo real, así que cuántos substeps caen entre dos
     frames depende de la máquina y el corte varía unos pocos resortes. Da ~860
     en esta máquina; la banda es amplia a propósito. Lo que sí es estable es que
     separa en dos. */
  expect((await cuts(page)).severed).toBeGreaterThan(700);
});

test('después de orbitar, el corte sigue el plano de pantalla', async ({ page }) => {
  const errs = problems(page);

  /* Se gira la cámara mientras corren los frames lentos del fixture, antes de
     que llegue el tajo. Si el corte no acompañara a la cámara —si siguiera
     siendo un prisma sobre el eje Z del mundo— después de girar 90 grados no
     cortaría nada. */
  await runReplay(page, async () => {
    await page.evaluate(async () => {
      dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      await new Promise((r) => setTimeout(r, 900));
      dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    });
  });

  expect((await cuts(page)).events).toBeGreaterThan(0);
  expect(Number(await pieces(page))).toBeGreaterThanOrEqual(2);
  expect(errs).toEqual([]);
});

test('el reset deja la sandía entera y restaura la forma de reposo', async ({ page }) => {
  const errs = problems(page);
  await runReplay(page);
  expect((await cuts(page)).events).toBeGreaterThan(0);

  await page.locator('#btnReset').click();
  await page.waitForTimeout(1200);

  expect(await pieces(page)).toBe('1');
  expect((await cuts(page)).events).toBe(0);
  // sin caras de corte no hay nada que medir: la sandía volvió a estar cerrada
  expect((await page.evaluate(() => window.__dev.cutFacePlanarity())).points).toBe(0);
  expect(errs).toEqual([]);
});

test('el corte salpica jugo, y el jugo llega a la pantalla', async ({ page }) => {
  const errs = problems(page);
  await boot(page);

  /* No alcanza con contar gotas en CPU: el bug que esto cuida es que los puntos
     existan y aun así no se dibujen, porque sus buffers GL se crearon vacíos y
     quedaron cacheados en ese estado. Hay que mirar píxeles.
     Para que la comparación sea limpia se congela la simulación: si no, los dos
     frames difieren también porque la gelatina se movió. */
  const result = await page.evaluate(async (o) => {
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const move = (x, y) => dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
    const cx = innerWidth / 2, fromY = 40;
    let d = 0;
    move(cx, fromY); await raf();
    const warm = performance.now();
    while (performance.now() - warm < o.warmMs) {
      d = ((performance.now() - warm) / 1000) * o.warmPxPerSec;
      move(cx, fromY + d); await raf();
    }
    const base = d, t0 = performance.now();
    for (;;) {
      d = base + Math.min(o.distancePx, ((performance.now() - t0) / 1000) * o.pxPerSec);
      move(cx, fromY + d);
      if (d - base >= o.distancePx) break;
      await raf();
    }

    const count = window.__dev.juiceCount;
    window.__dev.pause();

    // capturar justo después de un render: el drawing buffer no se preserva
    const cv = document.getElementById('gl');
    const grab = () => new Promise((r) => requestAnimationFrame(() => r(cv.toDataURL('image/png'))));
    const load = (u) => new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = u; });

    window.__dev.setJuiceVisible(true);
    const withJuice = await load(await grab());
    window.__dev.setJuiceVisible(false);
    const without = await load(await grab());

    const off = document.createElement('canvas');
    off.width = withJuice.width; off.height = withJuice.height;
    const g = off.getContext('2d');
    g.drawImage(withJuice, 0, 0);
    const a = g.getImageData(0, 0, off.width, off.height).data;
    g.clearRect(0, 0, off.width, off.height);
    g.drawImage(without, 0, 0);
    const b = g.getImageData(0, 0, off.width, off.height).data;

    let diff = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) > 12 || Math.abs(a[i + 1] - b[i + 1]) > 12) diff++;
    }
    window.__dev.setJuiceVisible(null);
    window.__dev.resume();
    return { count, diff, pixels: off.width * off.height };
  }, (() => {
    const pxPerWorld = page.viewportSize().height / VISIBLE_WORLD_HEIGHT;
    return {
      warmMs: WARM_MS,
      warmPxPerSec: 1.0 * pxPerWorld,
      pxPerSec: SLASH.worldPerSec * pxPerWorld,
      distancePx: SLASH.worldDistance * pxPerWorld,
    };
  })());

  expect(result.count).toBeGreaterThan(0);
  // el jugo tiene que cambiar píxeles de verdad, no solo existir en memoria
  expect(result.diff).toBeGreaterThan(200);
  expect(errs).toEqual([]);
});

/* Con deviceScaleFactor 1 el buffer coincide con el CSS por casualidad y el bug
   no se ve: hay que pedir DPR 2 explícitamente o el test no prueba nada. */
test.describe('HiDPI', () => {
  test.use({ deviceScaleFactor: 2 });

  test('la escena queda encuadrada con devicePixelRatio 2', async ({ page }) => {
  const errs = problems(page);
  await boot(page);

  // un canvas es elemento reemplazado: sin width/height explícitos toma su
  // tamaño de drawing buffer y con DPR 2 la escena se dibuja al doble y corrida
  const fit = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return { bufW: c.width, bufH: c.height, cssW: c.clientWidth, cssH: c.clientHeight, dpr: devicePixelRatio };
  });
  expect(fit.dpr).toBe(2);
  expect(fit.cssW).toBe(Math.round(fit.bufW / fit.dpr));
  expect(fit.cssH).toBe(Math.round(fit.bufH / fit.dpr));
  expect(fit.cssW).toBe(page.viewportSize().width);
  expect(errs).toEqual([]);
  });
});

test('la planaridad de la cara de corte da la línea base', async ({ page }) => {
  await runReplay(page);

  const m = await page.evaluate(() => window.__dev.cutFacePlanarity());
  expect(m.points).toBeGreaterThan(100);

  /* `restRms` mide la escalera sobre las posiciones de reposo: sin deformación,
     así que sale idéntico corrida a corrida. Es la línea base que tiene que
     bajar la geometría sub-celda. Da ~0.084, o sea media celda de la lattice
     (0.18), que es exactamente la amplitud del escalón. Objetivo: < 0.02. */
  expect(m.restRms).toBeGreaterThan(0.06);
  expect(m.restRms).toBeLessThan(0.11);

  /* Sobre la malla tal como se dibuja, el número incluye el bamboleo de la
     gelatina, y **cuánto bamboleo queda depende del framerate**: la espera de
     después del corte es de tiempo real, así que a 60 fps se simulan ~70 pasos y
     a 5 fps unos pocos. Medido, eso da 0.03 en las corridas rápidas y 0.3 en las
     lentas: un orden de magnitud, por la máquina y no por el código. Acá solo se
     comprueba que la métrica esté viva; para comparar antes y después está
     `restRms`, que se mide sobre posiciones de reposo y sale idéntico siempre. */
  expect(m.rms).toBeGreaterThan(0);
});

test('el replay de landmarks mueve el cuchillo y corta', async ({ page }) => {
  const errs = problems(page);
  await runReplay(page);

  const c = await cuts(page);
  expect(c.events).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

/* ── mecánica «Cuchillo»: dibujar una línea y tajar ──────────────────────── */

/**
 * Arranca directamente en una mecánica, sin pasar por el selector.
 *
 * `?mech=` existe para esto y para desarrollo: elegir desde la UI es otro test.
 */
async function bootMech(page, id) {
  await boot(page, `?dev&mech=${id}`);
}

/**
 * Dibuja una línea con el mouse: apoyar en A, arrastrar hasta B, soltar.
 *
 * Nada de esto depende de la velocidad —esta mecánica no tiene umbral— así que
 * no hacen falta las unidades de mundo por segundo que necesita el tajo libre.
 * Lo que sí importa es **esperar** antes de apretar: la cuchilla sigue al
 * puntero con suavizado, y A se fija donde está la cuchilla, no donde está el
 * cursor. Sin la espera, A queda a mitad de camino del movimiento anterior.
 */
async function lineDrag(page, from, to) {
  const { width, height } = page.viewportSize();
  await page.evaluate(async (o) => {
    const cv = document.getElementById('gl');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const move = (x, y) => dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));

    move(o.x0, o.y0);
    for (let i = 0; i < 25; i++) await raf();   // que el suavizado alcance a A

    cv.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: o.x0, clientY: o.y0, button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true,
    }));
    for (let i = 1; i <= 14; i++) {
      move(o.x0 + (o.x1 - o.x0) * i / 14, o.y0 + (o.y1 - o.y0) * i / 14);
      await raf();
    }
    for (let i = 0; i < 14; i++) await raf();   // y que alcance a B
    dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  }, {
    x0: from[0] * width, y0: from[1] * height,
    x1: to[0] * width,   y1: to[1] * height,
  });

  /* Esperar a que la cuchilla **vuelva a su sitio**, no una cantidad fija de
     milisegundos. El golpe y la retirada son unos 600 ms de animación, pero se
     consumen en frames: con el navegador renderizando por software y la máquina
     cargada se pueden ir a varios segundos, y un `waitForTimeout(1600)` deja el
     test afirmando sobre un corte que todavía no pasó. Esto no depende de los
     fps. */
  await page.waitForFunction(
    () => window.__dev.mechanicState.state === 'idle', null, { timeout: 60_000 });
}

/**
 * Trazo que cruza la sandía entera, de lado a lado, **con margen**.
 *
 * El extremo A tiene que caer claramente afuera de la fruta. Con el trazo justo
 * —A a una décima del borde— el corte queda a merced de cuántos frames alcance
 * a tener el suavizado del puntero: en una corrida lenta A aterriza adentro, el
 * tajo no llega al borde y la sandía queda entera con una muesca. Eso es
 * correcto (el corte está acotado a la línea) y hace el test inestable.
 */
const ACROSS = [[0.16, 0.72], [0.86, 0.46]];

const mechanic = (page) => page.evaluate(() => window.__dev.mechanic);
/**
 * Congela la simulación sin impedir que se corte.
 *
 * Un segundo tajo sobre una mitad depende de dónde quedó esa mitad, y las
 * mitades se siguen moviendo: cuánto se desplazaron depende de cuántos frames
 * cayeron, o sea de la carga de la máquina. Con la física quieta, la geometría
 * del segundo corte es la misma siempre. El golpe de la cuchilla igual se anima,
 * porque la mecánica se actualiza antes del congelado.
 */
const freeze = (page) => page.evaluate(() => window.__dev.pause());
const lastCut = (page) => page.evaluate(() => window.__dev.mechanicState.lastCut);

test('arranca en la mecánica por defecto, y ?mech elige otra', async ({ page }) => {
  await boot(page);
  expect(await mechanic(page)).toBe('handKnife');

  await bootMech(page, 'lineKnife');
  expect(await mechanic(page)).toBe('lineKnife');
});

test('arrastrar y soltar parte la sandía en dos', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  await lineDrag(page, ...ACROSS);

  expect(await pieces(page)).toBe('2');
  expect((await cuts(page)).events).toBe(1);

  // y la cara expuesta existe: es la misma que mide la planaridad
  const m = await page.evaluate(() => window.__dev.cutFacePlanarity());
  expect(m.points).toBeGreaterThan(100);
  expect(errs).toEqual([]);
});

test('un trazo más corto que el mínimo no corta', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  // unos pocos píxeles: por debajo de MIN_CUT_LEN en unidades de mundo
  await lineDrag(page, [0.5, 0.6], [0.515, 0.597]);

  expect((await cuts(page)).events).toBe(0);
  expect(await pieces(page)).toBe('1');
  expect(errs).toEqual([]);
});

test('cambiar de mecánica en caliente conserva los pedazos', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');
  await lineDrag(page, ...ACROSS);
  expect(await pieces(page)).toBe('2');

  await page.selectOption('#mech', 'handKnife');
  await page.waitForTimeout(600);
  expect(await mechanic(page)).toBe('handKnife');
  expect(await pieces(page)).toBe('2');

  await page.selectOption('#mech', 'lineKnife');
  await page.waitForTimeout(600);
  expect(await mechanic(page)).toBe('lineKnife');
  expect(await pieces(page)).toBe('2');
  expect(errs).toEqual([]);
});

test('una mitad se puede volver a cortar', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  await lineDrag(page, ...ACROSS);
  expect(await pieces(page)).toBe('2');
  await freeze(page);

  /* Segundo trazo, cruzado con el primero y **de borde a borde**. Después del
     primer corte las mitades se abren y se acomodan: un trazo que apenas cubría
     la sandía entera deja de cubrirlas, y lo que asoma más allá de las puntas de
     la línea no se corta —que es justo lo que pide el requisito de no usar un
     plano infinito—. Entonces el corte se ve y no separa. */
  await lineDrag(page, [0.47, 0.06], [0.57, 0.99]);

  expect(Number(await pieces(page))).toBeGreaterThan(2);
  expect((await cuts(page)).events).toBe(2);
  expect((await lastCut(page)).severed).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

/* ── precisión del corte ─────────────────────────────────────────────────── */

const score = (page) => page.evaluate(() => window.__dev.score);
/** Trazo con el puntero que pasa cerca del centro de la sandía. */
const CENTRADO = [[0.40, 0.86], [0.60, 0.18]];

/**
 * Corta por una línea en coordenadas de **mundo**, sin gesto.
 *
 * Dibujar un trazo se lleva decenas de frames, y a los 10 fps que da el
 * navegador por software eso son segundos por corte: tres cortes en un test lo
 * dejan al borde de que el navegador se caiga. Lo que el gesto prueba —que el
 * puntero se traduce bien a una línea y que la cuchilla baja— lo cubre el test
 * de abajo, una vez. El resto del puntaje se prueba con la línea puesta a mano,
 * que además es exacta: se puede afirmar «por el centro da 50/50».
 */
const cutLine = (page, ax, az, bx, bz) =>
  page.evaluate(([a, b, c, d]) => window.__dev.cutLine(a, b, c, d), [ax, az, bx, bz]);

test('un corte con el gesto puntúa, y el puntaje describe el reparto', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  await lineDrag(page, ...CENTRADO);

  const { stats, last } = await score(page);
  expect(stats.count).toBe(1);
  expect(last).not.toBe(null);

  // los porcentajes suman 100: el material del tajo no se pierde de la cuenta
  expect(last.split[0] + last.split[1]).toBeCloseTo(100, 6);
  // y la precisión es coherente con ellos
  expect(last.precision).toBeCloseTo(100 - Math.abs(last.split[0] - last.split[1]), 1);
  // el padre es la sandía entera y los hijos son dos piezas nuevas
  expect(last.childIds).toHaveLength(2);
  expect(last.childIds).not.toContain(last.parentPieceId);
  expect(errs).toEqual([]);
});

test('por el centro da mitad y mitad; por el borde, claramente desparejo', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  await cutLine(page, 0, -1.6, 0, 1.6);
  const centro = (await score(page)).last;
  expect(centro.split[0]).toBeCloseTo(50, 0);
  expect(centro.precision).toBeGreaterThan(99);
  expect(centro.grade).toBe('Perfecto');

  await page.locator('#btnReset').click();
  await page.waitForTimeout(400);

  await cutLine(page, 0.45, -1.6, 0.45, 1.6);
  const borde = (await score(page)).last;
  expect(Math.max(...borde.split)).toBeGreaterThan(65);
  expect(borde.precision).toBeLessThan(70);
  expect(errs).toEqual([]);
});

test('el puntaje de un corte no cambia después', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');
  await cutLine(page, 0.1, -1.6, 0.1, 1.6);

  /* El puntaje se mide una sola vez, en el instante del corte, y queda. Los
     pedazos siguen moviéndose —se abren y se caen— pero el número no.
     Que ese número además no dependa de **cuán deformada** estaba la gelatina en
     ese instante es la otra mitad del asunto, y se prueba en Node, donde se puede
     aplastar un lado a voluntad: «aplastar un lado no cambia el reparto medido».
     Acá no se puede: una remedición en vivo cambia igual, porque los pedazos se
     alejaron del plano. */
  const first = (await score(page)).last;
  await page.waitForTimeout(900);
  const then = (await score(page)).last;
  await page.waitForTimeout(900);
  const later = (await score(page)).last;

  expect(then.precision).toBe(first.precision);
  expect(later.precision).toBe(first.precision);
  expect(later.split).toEqual(first.split);
  expect(later.volumes).toEqual(first.volumes);

  /* Y los pedazos sí se movieron: el número quieto no es porque no pase nada.
     Es solo prueba de vida, no una afirmación sobre cuánto: medir de nuevo es
     determinista, así que sin movimiento daría exactamente lo mismo. Cuánto
     derivan depende de cuántos frames cayeron. */
  const moved = await page.evaluate(() => window.__dev.splitAt(0.1, -1.6, 0.1, 1.6));
  expect(Math.abs(moved[0] - first.split[0])).toBeGreaterThan(0.005);
  expect(errs).toEqual([]);
});

test('recortar una mitad se puntúa contra esa mitad', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');

  await cutLine(page, 0, -1.6, 0, 1.6);              // en dos mitades
  const entera = (await score(page)).last;

  /* Congelar antes del segundo corte. Las mitades se abren y se caen, y el plano
     del segundo tajo está fijo en el mundo: cuanto más se movieron, menos pasa
     por el centro de cada una. Cuánto se mueven depende de cuántos frames
     cayeron entre un corte y el otro, o sea de la máquina. */
  await freeze(page);

  /* Una línea perpendicular, también de borde a borde: parte **las dos** mitades
     por su propio centro. Una línea acotada a una sola mitad sería más directa,
     pero su extremo cae justo en el hueco entre las dos y qué tan ancho es ese
     hueco depende otra vez de cuánto se separaron. De borde a borde no hay nada
     marginal. */
  await cutLine(page, -1.6, 0, 1.6, 0);
  const st = (await score(page)).stats;
  expect(st.count).toBe(3);

  const hijos = await page.evaluate(() => window.__dev.score.history.slice(-2));

  for (const e of hijos) {
    /* Si el puntaje fuera contra la sandía entera, partir una mitad por el medio
       daría 25/75. Contra su propia mitad, da 50/50. */
    expect(e.split[0]).toBeCloseTo(50, 0);
    expect(e.precision).toBeGreaterThan(95);
    // y cada una midió la mitad del volumen que midió el corte de la sandía entera
    const suya = e.volumes[0] + e.volumes[1];
    const todo = entera.volumes[0] + entera.volumes[1];
    expect(suya / todo).toBeCloseTo(0.5, 1);
  }
  expect(errs).toEqual([]);
});

test('las estadísticas acumulan y el botón las reinicia', async ({ page }) => {
  await bootMech(page, 'lineKnife');

  await cutLine(page, 0, -1.6, 0, 1.6);              // perfecto
  const perfecto = (await score(page)).stats.last;
  expect(perfecto).toBeGreaterThan(99);

  await freeze(page);                                // que no se muevan entre corte y corte
  await cutLine(page, -1.6, 0.55, 1.6, 0.55);        // torcido, sobre las dos mitades

  let st = (await score(page)).stats;
  expect(st.count).toBe(3);
  expect(st.best).toBe(perfecto);                    // el mejor no es el último
  expect(st.last).toBeLessThan(perfecto);
  expect(st.avg).toBeLessThan(st.best);
  expect(await page.locator('#statLast').innerText()).not.toBe('—');

  await page.locator('#btnStatsReset').click();
  st = (await score(page)).stats;
  expect(st.count).toBe(0);
  expect(await page.locator('#statLast').innerText()).toBe('—');
});

test('un golpe que parte dos piezas puntúa las dos', async ({ page }) => {
  await bootMech(page, 'lineKnife');
  await cutLine(page, 0, -1.6, 0, 1.6);              // dos mitades
  const antes = (await score(page)).stats.count;

  // una línea perpendicular cruza las dos: dos splits en un solo golpe
  await cutLine(page, -1.6, 0, 1.6, 0);
  const st = (await score(page)).stats;
  expect(st.count).toBe(antes + 2);
});

test('el puntaje solo aparece donde el corte es un plano', async ({ page }) => {
  await boot(page);                       // tajo libre
  await expect(page.locator('#statsChip')).toBeHidden();
  await expect(page.locator('#practiceChip')).toBeHidden();

  await page.selectOption('#mech', 'lineKnife');
  await expect(page.locator('#statsChip')).toBeVisible();
  await expect(page.locator('#practiceChip')).toBeVisible();
});

test('el modo práctica muestra el reparto antes de cortar', async ({ page }) => {
  const errs = problems(page);
  await bootMech(page, 'lineKnife');
  await page.locator('#practice').check();

  const { width, height } = page.viewportSize();
  const shown = await page.evaluate(async (o) => {
    const cv = document.getElementById('gl');
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const move = (x, y) => dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));

    move(o.x0, o.y0);
    for (let i = 0; i < 25; i++) await raf();
    cv.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: o.x0, clientY: o.y0, button: 0, pointerId: 1, pointerType: 'mouse', bubbles: true,
    }));
    for (let i = 1; i <= 14; i++) {
      move(o.x0 + (o.x1 - o.x0) * i / 14, o.y0 + (o.y1 - o.y0) * i / 14);
      await raf();
    }
    // el recálculo va a 10 Hz: hay que darle una ventana, contada en frames
    for (let i = 0; i < 12; i++) await raf();
    const mid = document.getElementById('practiceSplit').textContent;
    dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
    return mid;
  }, {
    x0: CENTRADO[0][0] * width, y0: CENTRADO[0][1] * height,
    x1: CENTRADO[1][0] * width, y1: CENTRADO[1][1] * height,
  });
  await page.waitForFunction(
    () => window.__dev.mechanicState.state === 'idle', null, { timeout: 60_000 });

  // durante el apuntado mostró un reparto, no el guion
  expect(shown).toMatch(/^\d+\/\d+$/);
  const [a, b] = shown.split('/').map(Number);
  expect(a + b).toBeGreaterThan(98);
  expect(a + b).toBeLessThan(102);

  // y al cortar, el puntaje real se parece a lo que anticipó
  const last = (await score(page)).last;
  expect(Math.abs(Math.max(a, b) - Math.max(...last.split))).toBeLessThan(6);
  expect(errs).toEqual([]);
});

test('la cruz de apuntado se ve de verdad', async ({ page }) => {
  /* No alcanza con mirar la opacidad: sin CSS un div vacío **también** reporta
     opacidad 1, que es el default. Eso fue exactamente lo que dejó pasar que la
     cruz se shippeara invisible. Lo que hay que mirar es el tamaño. */
  await bootMech(page, 'lineKnife');

  const box = await page.evaluate(() => {
    const c = document.getElementById('cross');
    const r = c.getBoundingClientRect();
    const bars = [...c.querySelectorAll('i')].map((i) => {
      const b = i.getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    return { w: r.width, h: r.height, bars };
  });

  expect(box.w).toBeGreaterThan(8);
  expect(box.h).toBeGreaterThan(8);
  expect(box.bars).toHaveLength(2);
  for (const b of box.bars) expect(b.w * b.h).toBeGreaterThan(0);
});
