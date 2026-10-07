import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  /* En serie, siempre. Estos tests miden comportamiento dependiente del tiempo
     (velocidad de la hoja en unidades de mundo por segundo) sobre WebGL
     renderizado por software. Varias instancias en paralelo se roban CPU entre
     sí, los fps colapsan y los barridos se quedan sin frames: los tests fallan
     en paralelo y pasan de a uno. */
  fullyParallel: false,
  /* El navegador renderiza por software a unos 10 fps, y un test que dibuja una
     línea con el mouse necesita decenas de frames: entre el suavizado del
     puntero, el golpe y la retirada, un solo trazo se lleva siete segundos. Los
     30 s de fábrica alcanzaban cuando los gestos eran barridos cortos; con dos
     trazos en el mismo test, no. No es que se cuelguen: tardan. */
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      // la lógica de tracking no toca el DOM, así que corre sin navegador
      name: 'node',
      testMatch: /.*\.node\.spec\.js/,
    },
    {
      name: 'chrome',
      testIgnore: /.*\.node\.spec\.js/,
      use: {
        ...devices['Desktop Chrome'],
        // Chrome del sistema en vez del Chromium que trae Playwright: este no
        // tiene build para Ubuntu 20.04, y el canal estable anda en todos lados
        channel: 'chrome',
        /* En CI no hay GPU, así que se renderiza por software. Fuera de CI se usa
           el driver real a propósito: algunos problemas de esta app son del
           driver (un buffer GL creado vacío que queda cacheado inservible) y
           bajo swiftshader no aparecen. */
        launchOptions: process.env.CI
          ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }
          : {},
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
