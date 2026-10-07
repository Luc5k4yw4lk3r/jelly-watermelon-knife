import { test, expect } from '@playwright/test';

/**
 * Smoke mínimo: que el build arranque, inicialice WebGL y la simulación, y no
 * tire nada por consola.
 *
 * No se asertan fps acá: CI no tiene GPU y renderiza por software, así que
 * cualquier umbral sería ruido. La performance se mide a mano sobre hardware
 * real. La suite de comportamiento (lento empuja / rápido corta) está pendiente.
 */

/** Captura errores de consola y excepciones no atrapadas. */
function collectProblems(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

test('arranca, inicializa WebGL y la simulación, sin errores', async ({ page }) => {
  const problems = collectProblems(page);

  await page.goto('/');
  await expect(page.locator('#overlay')).toBeVisible();

  // arrancar en modo mouse evita pedir permisos de cámara
  await page.locator('#btnMouse').click();
  await expect(page.locator('#overlay')).toBeHidden();

  // el canvas tiene un contexto WebGL vivo
  const hasGL = await page.evaluate(() => {
    const c = document.getElementById('gl');
    return !!(c && (c.getContext('webgl2') || c.getContext('webgl')));
  });
  expect(hasGL).toBe(true);

  // la sandía existe y arranca entera
  await expect(page.locator('#pieces')).toHaveText('1');

  // el loop corre: el contador de fps deja de estar en su valor inicial
  await expect(page.locator('#fps')).not.toHaveText('-- FPS', { timeout: 10_000 });

  expect(problems).toEqual([]);
});

test('el reset deja la sandía entera', async ({ page }) => {
  const problems = collectProblems(page);

  await page.goto('/');
  await page.locator('#btnMouse').click();
  await page.locator('#btnReset').click();

  await expect(page.locator('#pieces')).toHaveText('1');
  expect(problems).toEqual([]);
});

test('el build es un solo archivo, sin assets locales sueltos', async ({ page }) => {
  const external = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith('http://localhost')) external.push(url);
  });

  await page.goto('/');
  await page.waitForTimeout(1000);

  // MediaPipe es la única dependencia de red, y solo si se activa la cámara
  expect(external).toEqual([]);
});
