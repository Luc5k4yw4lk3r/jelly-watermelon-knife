import { test, expect } from '@playwright/test';
import { GRADES } from '../src/config.js';
import { scoreSplit, gradeOf, createScoreboard } from '../src/score/cutScore.js';

/**
 * El puntaje, que es aritmética pura y por eso se prueba sin nada alrededor.
 */

test('el reparto perfecto puntúa 100', () => {
  const s = scoreSplit([1, 1]);
  expect(s.precision).toBe(100);
  expect(s.ratio).toBe(1);
  expect(s.split).toEqual([50, 50]);
  expect(s.grade).toBe('Perfecto');
});

test('la precisión mide cuánto se desvió del medio', () => {
  // 45 / 55 → se desvió 10 puntos sobre 100
  expect(scoreSplit([45, 55]).precision).toBe(90);
  expect(scoreSplit([25, 75]).precision).toBe(50);
  expect(scoreSplit([1, 0]).precision).toBe(0);
  // y no depende de la escala, solo de la proporción
  expect(scoreSplit([0.45, 0.55]).precision).toBe(scoreSplit([450, 550]).precision);
});

test('los rangos caen justo en el umbral', () => {
  /* El borde importa: con `>=` un 99 clavado es Perfecto y un 98.99 no. Si
     alguna vez se recalibran los números, esto dice qué se rompió. */
  for (const g of GRADES) {
    if (g.min === -Infinity) continue;
    expect(gradeOf(g.min)).toBe(g.name);
  }
  expect(gradeOf(99)).toBe('Perfecto');
  expect(gradeOf(98.9)).toBe('Excelente');
  expect(gradeOf(97)).toBe('Excelente');
  expect(gradeOf(96.9)).toBe('Bien');
  expect(gradeOf(85)).toBe('Regular');
  expect(gradeOf(84.9)).toBe('Torcido');
  expect(gradeOf(0)).toBe('Torcido');
});

test('con migas, el puntaje mira las dos piezas grandes', () => {
  /* Los porcentajes incluyen todo y suman 100, pero la precisión es de las dos
     mitades: el jugador partió en dos, no en tres. */
  const s = scoreSplit([49, 49, 2]);
  expect(s.split.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
  expect(s.precision).toBe(100);
});

test('un reparto degenerado no rompe nada', () => {
  expect(scoreSplit([0, 0]).precision).toBe(0);
  expect(scoreSplit([]).precision).toBe(0);
});

/* ── historial ───────────────────────────────────────────────────────────── */

const split = (parent, children, volumes) => ({ parent, children, volumes });

test('el historial guarda lo que hace falta para reconstruir la jugada', () => {
  const sb = createScoreboard();
  const { entries } = sb.record([split(1, [2, 3], [0.6, 0.4])], 'hand');
  const e = entries[0];

  expect(e.parentPieceId).toBe(1);
  expect(e.childIds).toEqual([2, 3]);
  expect(e.volumes).toEqual([0.6, 0.4]);
  expect(e.inputSource).toBe('hand');
  expect(e.precision).toBe(80);
  expect(e.grade).toBe('Torcido');
  expect(typeof e.timestamp).toBe('number');
  expect(sb.history).toHaveLength(1);
});

test('las estadísticas siguen último, mejor, promedio y cantidad', () => {
  const sb = createScoreboard();
  expect(sb.stats()).toEqual({ count: 0, last: null, lastGrade: null, best: null, avg: null });

  sb.record([split(1, [2, 3], [0.5, 0.5])]);          // 100
  sb.record([split(2, [4, 5], [0.45, 0.55])]);        // 90
  const st = sb.stats();

  expect(st.count).toBe(2);
  expect(st.last).toBe(90);
  expect(st.lastGrade).toBe('Regular');
  expect(st.best).toBe(100);         // el mejor no es el último
  expect(st.avg).toBe(95);
});

test('un golpe que parte varias piezas devuelve el promedio de la jugada', () => {
  const sb = createScoreboard();
  const played = sb.record([
    split(1, [3, 4], [0.5, 0.5]),      // 100
    split(2, [5, 6], [0.4, 0.6]),      //  80
  ]);
  expect(played.entries).toHaveLength(2);
  expect(played.avg).toBe(90);
  expect(sb.stats().count).toBe(2);
});

test('resetear deja las estadísticas en cero pero no cambia el puntaje de nada', () => {
  const sb = createScoreboard();
  sb.record([split(1, [2, 3], [0.5, 0.5])]);
  sb.reset();
  expect(sb.stats().count).toBe(0);
  expect(sb.stats().best).toBe(null);
  expect(sb.history).toHaveLength(0);
});
