# Pendientes

Estado al cerrar **v0.3.0**. Ordenado por lo que más mueve la aguja, no por
esfuerzo. Cada ítem dice qué se sabe ya, para no tener que redescubrirlo.

---

## 1. Grabar fixtures de mano real · *bloqueado, necesita webcam*

El fixture que usan los tests (`tests/fixtures/slash-synthetic.json`) es
**sintético**: ejercita el camino completo y atrapa regresiones, pero no valida
que el gesto se sienta natural.

Cómo capturar uno real: abrir la app, `D` → **Grabar landmarks**, activar la
cámara, hacer el gesto, **Detener y bajar**. Conviene uno por caso: empuje lento,
tajo rápido, dos manos.

Es lo primero de la lista porque además cierra el otro pendiente que sigue:

## 2. Validar el tracking contra hardware · *bloqueado, necesita webcam*

**Nunca se probó con una mano real.** Todo el camino de cámara se ejercitó con un
stream sintético, que corre MediaPipe entero (modelo, delegate GPU,
`detectForVideo`, preview) pero nunca produce una detección.

Sin verificar: el mapeo landmarks→cuchillo, si el espejado se siente natural, la
ganancia del movimiento, y todo el camino de dos manos. Puede que haya que ajustar
`BLADE_LEN` o la escala del mapeo.

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

## Deuda de tests

- **El replay fija la entrada, no la simulación.** La física acumula pasos fijos
  contra tiempo real, así que el corte varía unos pocos resortes entre máquinas
  (838–860). Un modo de paso fijo atado al replay lo volvería bit-exacto, a costa
  de que la dinámica no sea la del juego real.
- **La trampa del buffer GL vacío no tiene test que la cuide.** Se intentó
  sabotear y no se reprodujo: ese bug necesitaba **dos** condiciones —buffer creado
  vacío *y* subidas parciales— y la segunda ya no existe en el código. Queda
  anotado en vez de fingir cobertura.
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
