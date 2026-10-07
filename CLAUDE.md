# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sandía de gelatina con física soft-body propia, cortable con un cuchillo 3D que
sigue la mano por webcam. Sin motor de física ni librerías de partículas: todo a
mano en typed arrays, con `three` como única dependencia de runtime.

El código, los comentarios, la documentación y los mensajes de commit están en
español. Mantener ese idioma.

## Comandos

```bash
pnpm install
pnpm dev                    # servidor de desarrollo con HMR
pnpm build                  # -> dist/index.html, un solo archivo autocontenido
pnpm preview                # sirve el build
pnpm test                   # toda la suite (buildea y sirve sola)
pnpm test --project=node    # solo unitarios, sin navegador: segundos en vez de minutos
pnpm test -g "reset"        # un test puntual, por nombre
```

La suite de navegador tarda ~4 min porque corre en serie y el navegador renderiza
por software. Para iterar sobre lógica, usá `--project=node`.

Banderas de URL para desarrollo: `?dev` expone `window.__dev` (pedazos,
telemetría de corte, estado de las hojas, planaridad de la cara de corte, pausa de
la simulación) y `?replay=<url>` reproduce una sesión de landmarks grabada.

`playwright.config.js` usa `channel: 'chrome'` (el Chrome del sistema) en vez del
Chromium que trae Playwright, que **no tiene build para Ubuntu 20.04**. En CI se
instala con `npx playwright install --with-deps chrome`.

## La restricción que explica el build

El entregable es *un archivo que se abre con doble clic*. Chrome trata las páginas
`file://` como origen opaco y **bloquea los `import` relativos entre archivos**
(los de CDN por https sí funcionan). Por eso se escribe en módulos bajo `src/` y
Vite + `vite-plugin-singlefile` vuelven a emitir un `dist/index.html` autocontenido.

No "simplificar" quitando el bundler: rompe el requisito central.

- `three` se bundlea desde npm. MediaPipe queda en el CDN con `import()` dinámico
  y `/* @vite-ignore */`, porque su WASM y su modelo de 7.8 MB se bajan en runtime
  igual.
- `modulePreload` está desactivado: en un solo script inline no hay nada que
  precargar y desde `file://` el polyfill intentaba fetchear el documento.
- `dist/` está en `.gitignore`. Se publica en Pages y se adjunta a cada release.

## Arquitectura

Cada módulo exporta una **factory** que recibe sus dependencias hacia abajo. Nada
importa "hacia arriba", así que no hay ciclos ni estado compartido en scope de
módulo. El orden de construcción en `main.js` importa:

```js
const view   = createScene(canvas);          // PRIMERO: la física usa su base de cámara
const lat    = createLattice();
const topo   = createTopology(lat);
const shape  = createShapeMatcher(lat);
const solver = createSolver(lat, shape, view.basis);
const cutter = createCutter(lat, view.basis);
```

Crear el solver o el cutter antes que `view` tira un TDZ (`Cannot access ... before
initialization`) que no es obvio leyendo el stack.

`cutter.cut(blade)` es **puro**: corta resortes y devuelve qué pasó. Reconstruir
topología, lanzar jugo, sonar el squish, destellar la hoja y actualizar el HUD son
decisiones de `main.js`. No volver a meter esos efectos dentro del cutter.

`docs/ARCHITECTURE.md` tiene los porqués en detalle y `docs/BACKLOG.md` lo que
falta, con el contexto ya averiguado de cada ítem — convienen antes de empezar algo
nuevo. Lo que sigue es lo que hay que saber antes de tocar nada.

### El shape matching no es opcional

Con 2 o 3 iteraciones de relajación la rigidez no se propaga a través de las 10
capas de la lattice y la sandía se despanzurra bajo su propio peso. El shape
matching (`physics/shapeMatching.js`) tira de cada pedazo hacia su forma de reposo
rotada, en O(N), y de paso le da forma propia a cada pedazo cortado.

Su descomposición polar **debe normalizarse** antes de iterar Newton: `Apq` tiene
magnitud del orden de N y la iteración solo divide la escala a la mitad por vuelta,
así que sin normalizar queda un factor de ~1.7 metido dentro de la "rotación" y la
gelatina se infla 50% y gira sola.

### El corte vive en espacio de cámara

Las partículas se proyectan a la base de la cámara (derecha / arriba / profundidad)
y el prisma se extiende sobre el eje de visión. **No usar XY del mundo**: eso rompe
la órbita. `view.basis` expone la base como números planos para los bucles calientes.

El cuchillo corta **de punta**. Si la hoja se mueve perpendicular a su eje, el área
barrida es un rectángulo tan ancho como larga la hoja y el cuchillo *excava* en vez
de rebanar. Tres defensas que no hay que "arreglar":

- El mouse apunta la hoja hacia donde va (`input/mouse.js`).
- `MAX_KERF` acota la componente lateral del barrido.
- `MAX_CUT_ROT` veta el corte mientras la hoja gira rápido, y la dirección **salta**
  en los giros bruscos en vez de interpolar: hacer easing a través de 180° barre la
  hoja por la sandía como un limpiaparabrisas.

### La pulpa roja no genera geometría

La malla tiene **todas** las caras de **todas** las celdas pre-construidas; solo se
dibujan las visibles, empaquetadas desde el slot 0. Una celda muere si pierde
cualquiera de sus 12 aristas estructurales, y las caras de las vecinas que quedan
sin par pasan a ser visibles. El shader las colorea por radio.

### config.js

Dos grupos a propósito: constantes **estructurales** (cambiarlas implica reconstruir
la simulación) y `tune`, un objeto mutable que el panel de tuneo escribe en vivo.
Al cambiar `K_STRUCT` / `K_SHEAR` / `K_BEND` hay que llamar `lat.refreshStiffness()`,
porque la rigidez está cacheada por resorte.

## Trampas que ya costaron caras

Tres líneas que parecen de más y no lo son:

- **`#gl { width:100%; height:100% }`** en el CSS. Un `<canvas>` es elemento
  reemplazado: `inset: 0` **no** lo estira, toma su tamaño de drawing buffer. Con
  `devicePixelRatio 2` la escena se dibuja al doble y desplazada fuera de cuadro.
  Con DPR 1 coincide por casualidad, así que no se nota probando en una pantalla
  común.
- **`points.visible = jCount > 0`** en `render/juice.js`. Si los buffers GL de esa
  geometría se crean en un frame con `drawRange` en 0 y datos en cero, el estado
  cacheado no se recupera nunca — ni subiendo el buffer entero, ni cambiando de
  material — y las gotas no se dibujan jamás.
- **`uFloorY` como uniform** en `render/jelly.glsl.js`, no interpolado como texto
  dentro del GLSL.

## Medir antes de afirmar una mejora

Acá se revirtieron dos mejoras de calidad que parecían obviamente buenas. El
procedimiento que quedó: definir la métrica **antes**, comprobar que distingue el
problema del no-problema, medir una línea base determinista, y aceptar el resultado.

La alineación de normales parecía la métrica natural para la cara de corte y era
inútil (ya daba 0.926 mientras la silueta seguía en escalera). La buena es
`window.__dev.cutFacePlanarity().restRms`, que se mide sobre posiciones de reposo y
por eso sale idéntica corrida a corrida.

Lo mismo con los tests: antes de dar una suite por buena, rompé el código a
propósito y confirmá que se pone en rojo. El test de HiDPI **pasaba con el bug
puesto** porque Playwright corre con `deviceScaleFactor: 1`, que es justo la
condición en que el bug no se manifiesta.

## Qué ya se probó y se descartó

**Aplanar la cara de corte.** Se intentó por dos caminos y **la medición descartó
los dos**: proyectar las partículas del borde sobre el plano de la hoja baja la
alineación de normales de 0.56 a 0.385, y suavizar a lo largo de la superficie da
resultados erráticos y no monótonos. La escalera la produce *qué celdas sobreviven*,
no dónde están las partículas.

Las normales ya están bien; lo feo es la **silueta**, que es geometría. Arreglarlo
de verdad pide geometría sub-celda, no más suavizado.

La métrica que decide es `window.__dev.cutFacePlanarity()` con `?dev`. Usá
`restRms`, que es determinista: **la línea base es 0.084**, media celda de la
lattice, que es justo la amplitud del escalón. Objetivo de un arreglo real: < 0.02.
Los detalles están en `docs/ARCHITECTURE.md`.

## Escribir tests acá

Dos reglas que no son obvias y que costaron una tarde:

**Las velocidades van en unidades de mundo por segundo, nunca en píxeles por
frame.** El umbral de corte está en esas unidades y el navegador de test renderiza
por software a pocos fps: el mismo gesto en píxeles por frame da velocidades
completamente distintas según la máquina. `tests/behaviour.spec.js` tiene el
helper `swipe()` que hace la conversión.

**La suite corre en serie** (`workers: 1`, `fullyParallel: false`). En paralelo,
varias instancias WebGL por software se roban CPU, los fps colapsan y los barridos
se quedan sin frames: la suite fallaba en paralelo y pasaba de a un test.

Para cualquier aserción que dependa de que el corte ocurra, usá **el replay**
(`runReplay()`), no un barrido de mouse: a 4 fps un tajo de mouse tiene 3 frames y
si la guarda de rotación veta uno, no corta. El replay avanza un frame grabado por
frame renderizado y es reproducible.

Pero el replay fija la **entrada**, no la simulación: la física acumula pasos fijos
contra tiempo real, así que el corte varía unos pocos resortes entre máquinas. Las
aserciones exactas van sobre `restRms` (posiciones de reposo, sin deformación).

## Verificar cambios

`pnpm test` cubre el contrato de interacción, la órbita, el reset, el jugo en
pantalla, el encuadre en HiDPI y el replay. Lo que sigue va igual a mano:

- 60 fps en reposo abriendo `dist/index.html` con `file://`, y consola limpia.
- **El tracking con una mano real.** Nunca se validó contra hardware: todo el
  camino de cámara se probó con un stream sintético, que ejercita MediaPipe
  completo (modelo, delegate GPU, `detectForVideo`, preview) pero nunca produce una
  detección. El mapeo landmarks→cuchillo, el espejado y el camino de dos manos
  siguen sin verificar. Para capturar una sesión y volverla fixture: `D` → **Grabar
  landmarks**.

## Commits

Conventional Commits, en español. Cada mensaje termina con:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

El historial arranca desde el prototipo de un solo archivo y la reestructuración va
encima, para que se vea qué cambió el refactor y qué no. Trabajo de features en
ramas `feat/*`, merge con `--no-ff`.
