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
pnpm test                   # smoke tests (buildea y sirve solo)
pnpm test -g "reset"        # un test puntual, por nombre
```

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

`docs/ARCHITECTURE.md` tiene los porqués en detalle. Lo que sigue es lo que hay que
saber antes de tocar nada.

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

## Qué ya se probó y se descartó

**Aplanar la cara de corte.** Se intentó por dos caminos y **la medición descartó
los dos**: proyectar las partículas del borde sobre el plano de la hoja baja la
alineación de normales de 0.56 a 0.385, y suavizar a lo largo de la superficie da
resultados erráticos y no monótonos. La escalera la produce *qué celdas sobreviven*,
no dónde están las partículas.

El control ya puntúa **0.926** de alineación con el 82% de las caras dentro de 30°:
las normales ya están bien, lo feo es la **silueta**, que es geometría. Arreglarlo
de verdad pide geometría sub-celda, no más suavizado. Los números están en
`docs/ARCHITECTURE.md`.

## Verificar cambios

Los smoke tests cubren arranque, WebGL, reset y que el build sea un solo archivo.
**No cubren comportamiento**, así que lo que sigue va a mano sobre el build, con
`file://` y también servido:

- Arrastre lento ≈ 400–800 px/s → 1 pedazo (empuja). Tajo rápido ≈ 2500 px/s →
  2 pedazos (corta).
- Orbitar 90° y volver a cortar: el corte tiene que seguir el plano de pantalla.
- Redimensionar en una pantalla con `devicePixelRatio 2`: la sandía queda centrada.
- 60 fps en reposo y consola limpia.

**El tracking nunca se validó con una mano real.** Todo el camino de cámara se
probó con un stream sintético, que ejercita MediaPipe completo (modelo, delegate
GPU, `detectForVideo`, preview) pero nunca produce una detección. El mapeo
landmarks→cuchillo, el espejado y el camino de dos manos siguen sin verificar
contra hardware.

## Commits

Conventional Commits, en español. Cada mensaje termina con:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

El historial arranca desde el prototipo de un solo archivo y la reestructuración va
encima, para que se vea qué cambió el refactor y qué no. Trabajo de features en
ramas `feat/*`, merge con `--no-ff`.
