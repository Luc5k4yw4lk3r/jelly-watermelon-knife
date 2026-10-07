# Pendientes

Estado al cerrar **v0.5.0**. Ordenado por lo que más mueve la aguja, no por
esfuerzo. Cada ítem dice qué se sabe ya, para no tener que redescubrirlo.

---

## 1. Grabar fixtures de mano real · *bloqueado, necesita webcam*

El fixture que usan los tests (`tests/fixtures/slash-synthetic.json`) es
**sintético**: ejercita el camino completo y atrapa regresiones, pero no valida
que el gesto se sienta natural.

Cómo capturar uno real: abrir la app, `D` → **Grabar landmarks**, activar la
cámara, hacer el gesto, **Detener y bajar**. Conviene uno por caso: empuje lento,
tajo rápido, dos manos, y ahora también **una pinza** para la mecánica de línea.

Es lo primero de la lista porque además cierra el otro pendiente que sigue:

## 2. Validar el tracking contra hardware · *bloqueado, necesita webcam*

**Nunca se probó con una mano real.** Todo el camino de cámara se ejercitó con un
stream sintético, que corre MediaPipe entero (modelo, delegate GPU,
`detectForVideo`, preview) pero nunca produce una detección.

Sin verificar: el mapeo landmarks→cuchillo, si el espejado se siente natural, la
ganancia del movimiento, y todo el camino de dos manos. Puede que haya que ajustar
`BLADE_LEN` o la escala del mapeo.

La mecánica de línea hereda el pendiente entero: **el pinch nunca se probó con una
mano real**. Los umbrales `PINCH_ON 0.25` / `PINCH_OFF 0.40` son un punto de
partida, no un número medido, y la normalización por tamaño de mano (muñeca →
nudillo del medio) solo se verificó con landmarks sintéticos.

## 3. Geometría sub-celda de la cara de corte · *el ítem grande*

La silueta escalonada es la mayor debilidad visual que queda. **Los atajos ya se
probaron y se midieron: los dos empeoran** (ver *Dos intentos de aplanar la cara de
corte* en [ARCHITECTURE.md](ARCHITECTURE.md)). La escalera la produce *qué celdas
sobreviven*, no dónde están las partículas.

El arreglo real: al morir una celda, recortarla contra el plano de corte y generar
el polígono de sección en vez de borrarla entera.

Lo que lo hace viable sin corrección por frame: si el plano se guarda **en el marco
de reposo del pedazo**, la clasificación de las 8 esquinas y los parámetros `t` de
intersección sobre las aristas se calculan una sola vez y quedan constantes,
porque `rest[]` no cambia. En render se interpolan las posiciones deformadas con
esos mismos `t` y la cara acompaña la deformación sola.

**Línea base ya medida:** `window.__dev.cutFacePlanarity().restRms` = **0.084**,
determinista, que es media celda de la lattice (0.18) — justo la amplitud del
escalón. Objetivo: **< 0.02**. Si no baja de forma clara, se revierte y se
documenta con los números, como los dos intentos anteriores.

No toca la física: `cellSolid` solo alimenta el render.

---

## Pulido que se nota al abrirlo

- **La sandía arranca inclinada ~15°** por el rebote inicial más la asimetría del
  solver. Debería arrancar apoyada.
- **La descarga del modelo de 7.8 MB no tiene progreso.** En una conexión lenta,
  «Iniciando…» se queda varios segundos sin decir nada.
- **La resolución adaptativa baja pero nunca vuelve a subir.** Una vez degradada,
  se queda así aunque la GPU se libere.
- **Los pedazos que quedan sin celdas visibles se siguen simulando** para siempre.
  Hay que detectarlos en `topology.rebuild()` y sacarlos del loop. Cuidado: hay que
  congelar la **componente** entera, no partículas sueltas, o se ancla un pedazo
  visible.

## Alcance

- **Táctil de verdad.** Hoy lo táctil solo mueve la cámara; el cuchillo no sigue al
  dedo. Además `cursor:none` no aplica en móvil y el panel de tuneo se oculta bajo
  560 px.
- **Self-host de MediaPipe** para que funcione sin conexión. Hoy el WASM y el
  modelo salen del CDN.
- **`prefers-reduced-motion`** sin contemplar.
- **Pinza para agarrar**: distancia pulgar–índice bajo un umbral cerca de un pedazo
  para engancharlo y tirarlo. Quedó afuera del hito de jugabilidad.

## Del puntaje

- **El tajo libre no puntúa.** Corta con un cuadrilátero barrido, no con un plano, y
  ahí un reparto no está definido. Se podría medir el volumen de los hijos contra el
  del padre —que ya se calcula— y puntuar eso, aceptando que el número incluye el
  material que se llevó el tajo.
- **El «peso» con densidades distintas para pulpa y cáscara** no se implementó, y no
  hay bandera: una opción de config que no hace nada es peor que no tenerla. La
  información necesaria ya está —`faceKind` distingue corteza de pulpa y el radio en
  reposo da el grosor de la cáscara—; lo que falta son dos densidades, que serían
  números inventados hasta que alguien decida qué significan.
- **Resaltar la cara de corte con el color del rango** quedó afuera. Era opcional, y
  el shader colorea por tipo de cara sin saber de piezas, así que pide un uniform más
  o un atributo por vértice.
- **El volumen absoluto queda 1% abajo** del elipsoide analítico, porque las celdas
  son hexaedros rectos inscritos en una superficie curva. Da igual para proporciones;
  importaría si alguna vez se mostrara un volumen en unidades.

## De la mecánica «Cuchillo»

- **Nunca se midieron los 60 fps con ~20 piezas** (R40 de la spec). Con 3 o 4 anda
  bien; el número de la spec está sin comprobar.
- **La cuchilla no empuja la gelatina mientras baja.** No se pidió, y meterla en el
  array de hojas del solver no sirve: ahí las hojas se colisionan como cápsulas en
  espacio de cámara extruidas por toda la profundidad. Haría falta una colisión por
  plano aparte.
- **Un trazo que no cruza la fruta entera corta y no separa.** Es correcto —el
  corte está acotado a la línea, que es lo que se pidió— pero se lee como un fallo:
  la cara de corte aparece y la pieza sigue siendo una. Un indicio visual de hasta
  dónde llega el corte lo volvería obvio.
- **La silueta escalonada también le toca.** Es el ítem 3 de arriba, y ahora se ve
  en dos mecánicas en vez de una.

## Deuda de tests

- **El replay fija la entrada, no la simulación.** La física acumula pasos fijos
  contra tiempo real, así que el corte varía unos pocos resortes entre máquinas
  (838–860). Un modo de paso fijo atado al replay lo volvería bit-exacto, a costa
  de que la dinámica no sea la del juego real.
- **La trampa del buffer GL vacío no tiene test que la cuide.** Se intentó
  sabotear y no se reprodujo: ese bug necesitaba **dos** condiciones —buffer creado
  vacío *y* subidas parciales— y la segunda ya no existe en el código. Queda
  anotado en vez de fingir cobertura.
- **La planaridad sobre la malla viva depende de la máquina.** `rms` incluye el
  bamboleo, y cuánto bamboleo queda después de una espera de tiempo real depende
  del framerate: 0.24–0.35 lento, 0.026–0.042 rápido. La aserción quedó como prueba
  de vida; comparar antes y después es trabajo de `restRms`. Entender por qué el
  bamboleo decae tan distinto sigue pendiente.
- **La suite de navegador pasa de 4 a ~8 min** con los tests de puntaje, porque cada
  trazo se lleva decenas de frames a 10 fps. Lo que la haría corta de verdad es poder
  cortar sin dibujar —una entrada directa de línea bajo `?dev`—, y dejar el gesto solo
  para los tests que lo prueban.
- **La suite de navegador tarda ~4 min**, porque corre en serie y el navegador
  renderiza por software. Para iterar sobre lógica está `pnpm test --project=node`,
  que tarda segundos.

## Performance

- **Compactar el array de resortes tras cada corte** en vez de saltear los muertos
  con un branch. **Baja prioridad:** el ahorro estimado es ~0.5 ms sobre 2.3 ms, y
  solo con la sandía muy cortada.
- **El jugo no colisiona con los pedazos**, los atraviesa.

## Mantenimiento

- Las acciones de CI (`checkout`, `setup-node`, `upload-artifact`, `pnpm/action-setup`)
  apuntan a Node 20, que GitHub ya marca como deprecado y fuerza a Node 24.
