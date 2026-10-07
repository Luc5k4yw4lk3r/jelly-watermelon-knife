# Spec — mecánica «Cuchillo» (dibujar línea y tajar)

> **Estado:** borrador, antes de implementar. Esta spec es la fuente de verdad: lo
> que no está acá no es requisito, y si la implementación la contradice se corrige
> **la spec** en el mismo commit, con el desvío escrito y justificado.

Versión objetivo: **v0.4.0**. Identificador de la mecánica: `lineKnife`.
Nombre visible: **Cuchillo**.

---

## 1. Para qué

La mecánica que ya existe (`handKnife`) es de destreza: el cuchillo sigue la mano y
hay que superar un umbral de velocidad para cortar. Es divertida y es imprecisa.

Esta suma la opción opuesta, **apuntar y confirmar**: se dibuja una línea sobre la
fruta y una cuchilla de carnicero baja y parte por un plano vertical. Sin umbral de
velocidad, el corte cae exactamente donde se apuntó.

Las dos conviven y se eligen en caliente. `handKnife` sigue siendo el default y **no
cambia en nada**: eso es un requisito, no una expectativa.

---

## 2. Requisitos

Cada requisito es una afirmación verificable. `MAYÚSCULAS` son claves de config
(§5).

### 2.1 Integración como opción

| ID | Requisito |
|---|---|
| **R1** | Existe una abstracción de mecánica con `enter()` / `exit()` / `update(dt, io)` / `dispose()`, y la mecánica actual la implementa **sin cambio de comportamiento observable**. |
| **R2** | `lineKnife` está registrada con el nombre visible «Cuchillo». |
| **R3** | La UI permite cambiar de mecánica en caliente, sin recargar la página. |
| **R4** | Al cambiar, la mecánica saliente limpia su estado: cancela el corte en curso y oculta su cuchillo, su guía y su cruz. |
| **R5** | Al cambiar, **los pedazos actuales de la sandía se conservan**. |
| **R6** | La mecánica inicial sale de `DEFAULT_MECHANIC`, que vale `handKnife`. |
| **R7** | Las dos mecánicas consumen la **misma** capa de input. |

### 2.2 Capa de input unificada

| ID | Requisito |
|---|---|
| **R8** | La capa emite, por slot, `{ nx, ny, pressed, source }` con `nx`/`ny` normalizados y `source ∈ {'mouse','hand'}`. |
| **R9** | Con mouse o táctil: la posición es la del cursor y `pressed` es el botón izquierdo (o un dedo apoyado). |
| **R10** | Con mano: el puntero es el punto medio entre las landmarks **4** (pulgar) y **8** (índice), con la imagen espejada igual que el resto del tracking. |
| **R11** | Con mano: `pressed` es el pinch, medido como `dist(4,8) / dist(0,9)` — normalizado por el tamaño de la mano, así no depende de la distancia a la cámara. |
| **R12** | El pinch tiene histéresis: entra por debajo de `PINCH_ON` y recién sale por encima de `PINCH_OFF`. |
| **R13** | El puntero de mano está suavizado con One Euro, con `EURO_MIN_CUTOFF` y `EURO_BETA`. |
| **R14** | Si se pierde la mano durante AIMING, el apuntado se **cancela**. |
| **R15** | Hay un indicador visual del pinch: la cruz se cierra o cambia de color. |
| **R16** | Las **dos** manos emiten puntero y pinch. La primera que presiona se queda con el trazo; la otra se ignora hasta volver a IDLE. |
| **R17** | La órbita de cámara sigue disponible en modo Cuchillo: botón derecho, **Shift+izquierdo** y las flechas. El botón izquierdo queda para dibujar. |

### 2.3 ESPERA (IDLE)

| ID | Requisito |
|---|---|
| **R18** | La cuchilla flota sobre la escena, **horizontal**, a `HOVER_H` sobre el centro de la fruta, y sigue al puntero en XZ con suavizado. |
| **R19** | La cuchilla proyecta sombra en el piso, para que se lea su altura. |
| **R20** | El cursor es una cruz chica. |

### 2.4 APUNTAR (AIMING)

| ID | Requisito |
|---|---|
| **R21** | Al presionar se fija el punto **A**. Mientras se arrastra, **B** sigue al puntero. |
| **R22** | A y B salen de intersectar el rayo del puntero con un **plano horizontal a la altura del centro de la fruta**, no con la malla. |
| **R23** | Se dibuja una línea guía fina sobre la fruta, de A a B. |
| **R24** | La cuchilla interpola hasta quedar centrada sobre el punto medio de AB, rotada en Y para ser paralela a AB, y **parada de canto con el filo hacia abajo**, en `ALIGN_MS`. |
| **R25** | `Esc` cancela: vuelve a ESPERA sin cortar. |

### 2.5 GOLPE (STRIKING)

| ID | Requisito |
|---|---|
| **R26** | Al soltar, si `|AB| > MIN_CUT_LEN`, la cuchilla baja **recta, solo en Y**, hasta atravesar el piso, en `STRIKE_MS` con ease-in (que se sienta pesado). |
| **R27** | Si `|AB| ≤ MIN_CUT_LEN`, vuelve a ESPERA **sin cortar**. |
| **R28** | El corte ocurre cuando la hoja **cruza el centro de la pieza**, no al terminar la animación. |
| **R29** | Durante GOLPE y RETIRADA el input nuevo no abre un apuntado; se encola **a lo sumo un** corte. |

### 2.6 CORTE

| ID | Requisito |
|---|---|
| **R30** | El plano de corte es **siempre vertical y contiene AB**: `normal = normalize(cross(B − A, UP))`, punto `= A`. |
| **R31** | Se corta solo dentro de la extensión de AB más `CUT_MARGIN`. **No es un plano infinito**: una pieza fuera de esa banda no se toca. |
| **R32** | La estructura de partículas/resortes se parte, y la cara de corte muestra pulpa roja, semillas y el anillo de cáscara en el borde. |
| **R33** | Cada mitad **hereda velocidad y deformación**. |
| **R34** | Cada mitad recibe un impulso de `SEP_IMPULSE` en ±normal, para que se abran. |
| **R35** | Las dos mitades siguen comportándose como gelatina (siguen tambaleando). |
| **R36** | Con `MAX_PIECES` alcanzado, el golpe no corta. |

### 2.7 RETIRADA (RETRACTING)

| ID | Requisito |
|---|---|
| **R37** | La cuchilla sube en `RETRACT_MS` y vuelve a ESPERA. |
| **R38** | Las piezas se pueden volver a cortar: rodajas → gajos → cubos. |

### 2.8 Máquina de estados

```
IDLE → AIMING → STRIKING → RETRACTING → IDLE
         └──────────────────────────────→ IDLE   (Esc, mano perdida, |AB| corto)
```

| ID | Requisito |
|---|---|
| **R39** | Las transiciones son exactamente las del diagrama; no hay otras. |

### 2.9 Rendimiento

| ID | Requisito |
|---|---|
| **R40** | Se mantienen ~60 fps con ~20 piezas. |

---

## 3. Criterios de aceptación

`[N]` = unitario en Node (`pnpm test --project=node`, segundos).
`[B]` = navegador contra el build (`pnpm test --project=chrome`).
`[M]` = verificación manual, porque ningún test lo cubre honestamente.

| ID | Criterio | Prueba | Cubre |
|---|---|---|---|
| **AC1** | La suite existente entera sigue verde después de mover la mecánica actual a la abstracción. | `[B]` suite completa, sin cambios | R1 |
| **AC2** | Con `?mech=lineKnife` la app arranca en Cuchillo; sin el parámetro, en la actual. | `[B]` «arranca en la mecánica por defecto» | R2, R6 |
| **AC3** | Cambiar de mecánica después de un corte conserva el contador de pedazos y no ensucia la consola. | `[B]` «cambiar de mecánica conserva los pedazos» | R3, R4, R5 |
| **AC4** | Un pinch que cierra por debajo de `PINCH_ON` reporta `pressed`; soltar hasta entre los dos umbrales **no** lo suelta; pasar `PINCH_OFF` sí. | `[N]` «el pinch tiene histéresis» | R12 |
| **AC5** | La misma pinza a dos escalas de mano (cerca y lejos) da el mismo `pressed`. | `[N]` «el pinch se normaliza por el tamaño de la mano» | R11 |
| **AC6** | El puntero de mano es el punto medio de 4 y 8, espejado. | `[N]` «el puntero sale del medio de pulgar e índice» | R10 |
| **AC7** | Perder la mano durante AIMING deja la FSM en IDLE sin pedir corte. | `[N]` «perder la mano cancela el apuntado» | R14 |
| **AC8** | `Esc` durante AIMING deja la FSM en IDLE sin pedir corte. | `[N]` «Esc cancela el apuntado» | R25 |
| **AC9** | Soltar con `|AB| ≤ MIN_CUT_LEN` vuelve a IDLE sin pedir corte. | `[N]` «una línea corta no corta» | R27 |
| **AC10** | Un trazo válido recorre `IDLE→AIMING→STRIKING→RETRACTING→IDLE` y pide **exactamente un** corte. | `[N]` «el ciclo completo pide un solo corte» | R26, R29, R39 |
| **AC11** | Presionar durante STRIKING o RETRACTING no abre un apuntado nuevo. | `[N]` «el input nuevo no interrumpe el golpe» | R29 |
| **AC12** | El corte se pide en el frame en que la hoja **cruza** la altura del centro, incluso si un solo frame la lleva de arriba de la fruta a abajo del piso. | `[N]` «el corte se dispara por cruce, no por cercanía» | R28 |
| **AC13** | La base de corte es ortonormal, su normal es **horizontal**, y A y B están **sobre** el plano (distancia ≈ 0 para los dos). | `[N]` «el plano de corte contiene AB y es vertical» | R30 |
| **AC14** | Un punto más allá de B por más de `CUT_MARGIN` cae **fuera** del quad barrido. | `[N]` «el corte no es un plano infinito» | R31 |
| **AC15** | Con el mouse: arrastrar sobre la fruta y soltar deja **2 pedazos**. | `[B]` «arrastrar y soltar parte la sandía en dos» | R21, R22, R26, R32 |
| **AC16** | Con el mouse: un arrastre más corto que `MIN_CUT_LEN` deja 1 pedazo y 0 cortes. | `[B]` «un trazo corto no corta» | R27 |
| **AC17** | Después del corte, la cara expuesta mide planaridad como cualquier otra (`cutFacePlanarity().points > 0`). | `[B]` «la cara de corte queda expuesta» | R32 |
| **AC18** | Las dos mitades se separan: la distancia entre sus centroides crece tras el golpe. | `[B]` «las mitades se abren» | R34 |
| **AC19** | Un segundo trazo sobre una mitad la vuelve a partir. | `[B]` «una mitad se puede volver a cortar» | R38 |
| **AC20** | Con `MAX_PIECES` alcanzado, un trazo válido no cambia el contador. | `[N]` «el límite de piezas veta el corte» | R36 |
| **AC21** | La cuchilla flota horizontal, sigue al puntero en XZ y proyecta sombra. | `[M]` | R18, R19 |
| **AC22** | La línea guía, la cruz y el indicador de pinch se ven y se leen. | `[M]` | R15, R20, R23 |
| **AC23** | La alineación y el golpe se sienten como se pidieron: lerp de ~`ALIGN_MS`, golpe pesado con ease-in, retirada. | `[M]` | R24, R26, R37 |
| **AC24** | Las mitades siguen tambaleando como gelatina y heredaron el movimiento que traían. | `[M]` | R33, R35 |
| **AC25** | ~60 fps con ~20 piezas, y consola limpia abriendo `dist/index.html` con `file://`. | `[M]` | R40 |
| **AC26** | Órbita con botón derecho, Shift+izquierdo y flechas mientras el izquierdo dibuja. | `[M]` | R17 |
| **AC27** | Pinch con una mano real, y con dos. | `[M]` | R16, R13 |

### 3.1 Requisitos sin test automático

Dicho explícitamente, en vez de quedar implícito:

- **R7** (misma capa de input) es estructural: lo prueba el hecho de que las dos
  mecánicas reciban el mismo objeto, no un test.
- **R13**, **R16**, **R17**, **R18**, **R19**, **R20**, **R23**, **R24**, **R33**,
  **R35**, **R37**, **R40** quedan en `[M]`. Son pose, estética, feel y hardware.
- **R16** y **R13** heredan el pendiente mayor del proyecto: **el camino de cámara
  nunca se validó contra una mano real** (`docs/BACKLOG.md`, ítems 1 y 2). Los
  umbrales `0.25 / 0.40` son punto de partida, no números medidos.

---

## 4. Decisiones de diseño y desvíos

### 4.1 El kerf pasa a ser parámetro por llamada

`cutter.cut()` acota a `MAX_KERF = 0.085` la componente del barrido **perpendicular
al eje de la hoja**, para que un cuchillo que se mueve de costado rebane en vez de
excavar. La cuchilla baja perpendicular a su propio filo: su barrido es 100% lateral.

Con el kerf de hoy, cada llamada cortaría una banda de 0.085 de alto y un tajo de
~2.2 unidades necesitaría ~26 frames consecutivos. **El navegador de los tests
renderiza por software y da 2.**

Por eso el kerf es un parámetro **por llamada**, con el valor de hoy por default, y
la cuchilla hace **una sola llamada** cuyo quad cubre todo el recorrido vertical. El
corte queda determinista e independiente del framerate.

Es el mismo error que ya documentamos con el `dt` recortado: un número puesto por la
estabilidad de un subsistema se vuelve mentira para cualquier otro que lo lea con
otra intención.

### 4.2 La restricción por pieza sale de la geometría, no de un filtro

R31 pide no usar un plano infinito. El quad ya está acotado a `[−CUT_MARGIN,
|AB| + CUT_MARGIN]` sobre el eje AB, así que los resortes más allá de las puntas no
se cortan **por construcción**. No hace falta AABB por pieza ni máscara dentro del
cutter.

Consecuencia aceptada: dos piezas a distinta profundidad, las dos bajo la línea
dibujada, se cortan las dos. Es lo que hace una cuchilla que baja.

### 4.3 Heredar velocidad y deformación es gratis

El corte solo escribe `sprAlive`; `pos`, `prev` y `rest` no se tocan, y el shape
matching re-ajusta una rotación nueva por mitad. R33 y R35 no necesitan código.

### 4.4 El disparo es un cruce, no una cercanía

R28 dice «cuando la hoja cruza el centro». Se implementa como cruce de signo
(`prevY > yc && y ≤ yc`), no como proximidad: con un frame largo la hoja pasa de
arriba de la fruta a abajo del piso y una prueba por cercanía no dispararía nunca.

### 4.5 La cuchilla no entra en la colisión del solver

El solver colisiona las hojas como cápsulas en espacio de cámara extruidas por toda
la profundidad. Una cuchilla metida ahí colisionaría a toda profundidad, en el lugar
equivocado. La cuchilla corta; no empuja. El spec original no pide que empuje.

### 4.6 El selector va en el HUD, no en el panel de tuneo

El panel `D` está oculto por CSS debajo de 560 px de ancho. Un control de juego ahí
sería inalcanzable en móvil.

---

## 5. Config expuesta

Nombres del spec original → claves reales.

| Spec | Clave | Default | Dónde |
|---|---|---|---|
| `knifeHoverHeight` | `HOVER_H` | 1.45 | `tune` |
| `alignDurationMs` | `ALIGN_MS` | 170 | `tune` |
| `strikeDurationMs` | `STRIKE_MS` | 340 | `tune` |
| `retractDurationMs` | `RETRACT_MS` | 250 | `tune` |
| `minCutLength` | `MIN_CUT_LEN` | 0.35 | `tune` |
| `separationImpulse` | `SEP_IMPULSE` | 0.02 | `tune` |
| `pinchOn` | `PINCH_ON` | 0.25 | `tune` |
| `pinchOff` | `PINCH_OFF` | 0.40 | `tune` |
| `oneEuroMinCutoff` | `EURO_MIN_CUTOFF` | 1.6 | `tune` |
| `oneEuroBeta` | `EURO_BETA` | 0.9 | `tune` |
| `maxPieces` | `MAX_PIECES` | 24 | `tune` |
| — | `CUT_MARGIN` | 0.06 | `tune` |
| `defaultMechanic` | `DEFAULT_MECHANIC` | `'handKnife'` | estructural |

`SEP_IMPULSE` tiene techo: `MAX_STEP_DISP = 0.09` recorta el desplazamiento total por
paso y de paso escala la velocidad que la partícula ya traía.

---

## 6. Trazabilidad

Se completa a medida que se implementa. `—` = todavía no.

| Requisito | Criterios | Estado |
|---|---|---|
| R1 | AC1 | ✔ suite completa en verde tras el traslado |
| R2 | AC2 | — |
| R3 | AC3 | — |
| R4 | AC3 | — |
| R5 | AC3 | — |
| R6 | AC2 | — |
| R7 | estructural | ✔ las mecánicas reciben el mismo `io` |
| R8 | AC6, AC15 | parcial: AC6 ✔ |
| R9 | AC15, AC16 | — |
| R10 | AC6 | ✔ |
| R11 | AC5 | ✔ |
| R12 | AC4 | ✔ (los dos sabotajes dieron rojo) |
| R13 | AC27 `[M]` | — |
| R14 | AC7 | parcial: el puntero suelta al perder la mano |
| R15 | AC22 `[M]` | — |
| R16 | AC27 `[M]` | — |
| R17 | AC26 `[M]` | — |
| R18 | AC21 `[M]` | — |
| R19 | AC21 `[M]` | — |
| R20 | AC22 `[M]` | — |
| R21 | AC15 | — |
| R22 | AC15 | — |
| R23 | AC22 `[M]` | — |
| R24 | AC23 `[M]` | — |
| R25 | AC8 | — |
| R26 | AC10, AC15 | — |
| R27 | AC9, AC16 | — |
| R28 | AC12 | — |
| R29 | AC10, AC11 | — |
| R30 | AC13 | — |
| R31 | AC14 | — |
| R32 | AC15, AC17 | — |
| R33 | AC24 `[M]` | — |
| R34 | AC18 | — |
| R35 | AC24 `[M]` | — |
| R36 | AC20 | — |
| R37 | AC23 `[M]` | — |
| R38 | AC19 | — |
| R39 | AC10 | — |
| R40 | AC25 `[M]` | — |
