# Spec — precisión del corte

> **Estado:** implementada en v0.5.0. Como la de la mecánica, lo que no está acá no
> es requisito, y donde la implementación la contradijo se corrigió **la spec**, con
> el desvío escrito (§4).

Mide qué tan parejo quedó un corte y lo muestra. No cambia cómo se corta.

---

## 1. Requisitos

| ID | Requisito |
|---|---|
| **V1** | Cuando un corte parte una pieza en dos, se mide el **volumen** que quedó de cada lado. |
| **V2** | El volumen se mide sobre la geometría de **reposo**, no sobre la deformada: el número no puede depender de cuán aplastada estaba la gelatina en ese instante. |
| **V3** | La suma de los hijos es el volumen del padre. El material que se lleva el tajo no desaparece de la cuenta. |
| **V4** | El puntaje es **relativo a la pieza que se cortó**, no a la sandía entera. |
| **V5** | `ratio` = menor / mayor; `split` = porcentajes; `precision` = `100·(1 − |a−b|/(a+b))` con un decimal. |
| **V6** | Rangos configurables por umbral de precisión, de *Perfecto* a *Torcido*. |
| **V7** | Si un golpe parte varias piezas, se puntúa cada una y se informa además el promedio de esa jugada. |
| **V8** | Cada medición queda en un historial con `{ id, timestamp, parentPieceId, childIds, volumes, split, precision, grade, inputSource }`. |
| **V9** | Dos etiquetas flotantes sobre cada mitad con su porcentaje, y un badge central con la precisión y el rango, coloreado por rango. Aparecen y se desvanecen. |
| **V10** | HUD con último, mejor, promedio y cantidad, más un botón para reiniciar las estadísticas. |
| **V11** | Modo práctica, apagado por defecto: mientras se apunta muestra el reparto proyectado de la línea, sin partir nada. |
| **V12** | El modo práctica no cuesta fps perceptibles. |
| **V13** | La mecánica original no se ve afectada. |
| **V14** | Funciona igual con el mouse y con la mano. |
| **V15** | Config expuesta: umbrales de rango, duración de las etiquetas, práctica por defecto y tolerancia de volumen. |

---

## 2. Criterios de aceptación

`[N]` Node · `[B]` navegador · `[M]` a mano.

| ID | Criterio | Prueba | Cubre |
|---|---|---|---|
| **AV1** | Un cubo unitario cortado en `x = t` deja exactamente `1 − t`. | `[N]` «un cubo cortado en x = t…» | V1 |
| **AV2** | Los tres casos del recorte (1, 2 y 3 vértices) dan la respuesta analítica. | `[N]` «el recorte cubre los tres casos…» | V1 |
| **AV3** | Aplastar **un solo lado**, sin mover material a través del plano, no cambia el reparto. | `[N]` «aplastar un lado no cambia el reparto medido» | V2 |
| **AV4** | La suma de los dos lados es el total, para cualquier plano. | `[N]` «el reparto conserva el volumen, siempre» | V3 |
| **AV5** | La suma de todas las piezas es el total aunque el corte mate celdas. | `[N]` «la suma de las piezas es el total…» | V3 |
| **AV6** | Recortar una mitad por su propio centro puntúa ~50/50, no 25/75. | `[N]` «recortar una mitad se mide contra esa mitad» · `[B]` «recortar una mitad se puntúa contra esa mitad» | V4 |
| **AV7** | Precisión y ratio contra números conocidos; escala invariante. | `[N]` «la precisión mide cuánto se desvió del medio» | V5 |
| **AV8** | Los rangos caen justo en su umbral. | `[N]` «los rangos caen justo en el umbral» | V6 |
| **AV9** | Un golpe que parte dos piezas registra dos y devuelve el promedio. | `[N]` «un golpe que parte varias piezas…» · `[B]` «un golpe que parte dos piezas puntúa las dos» | V7 |
| **AV10** | El historial guarda todos los campos. | `[N]` «el historial guarda lo que hace falta…» | V8 |
| **AV11** | Un corte con el gesto puntúa, los porcentajes suman 100 y los hijos son nuevos. | `[B]` «un corte con el gesto puntúa…» | V1, V8, V14 |
| **AV12** | Por el centro da ~50/50 y *Perfecto*; por el borde, desparejo y bajo. | `[B]` «por el centro da mitad y mitad…» | V1, V5, V6 |
| **AV13** | El puntaje de un corte no cambia después, aunque los pedazos sigan moviéndose. | `[B]` «el puntaje de un corte no cambia después» | V2 |
| **AV14** | Las estadísticas acumulan y el botón las reinicia. | `[B]` «las estadísticas acumulan…» | V10 |
| **AV15** | El puntaje y la práctica solo aparecen donde el corte es un plano. | `[B]` «el puntaje solo aparece donde el corte es un plano» | V13 |
| **AV16** | El modo práctica muestra un reparto mientras se apunta, y se parece al que termina dando el corte. | `[B]` «el modo práctica muestra el reparto antes de cortar» | V11 |
| **AV17** | Las etiquetas y el badge se ven, se leen sobre la pulpa y se desvanecen. | `[M]` | V9 |
| **AV18** | Sin caída de fps al cortar ni en modo práctica. | `[M]` | V12 |
| **AV19** | El puntaje con la mano. | `[M]` | V14 |

### 2.1 Sin test automático

**V9**, **V12** y **V19** quedan en `[M]`. **V14** está cubierto solo del lado del
mouse: la mano hereda el pendiente de siempre, que es que el camino de cámara nunca
se validó contra hardware.

---

## 3. Línea base medida

Reparto de un plano a distintas distancias del centro, sobre la lattice en reposo.
Son los números que fija `volume.node.spec.js`.

| distancia | reparto | precisión | rango |
|---|---|---|---|
| 0 | 50.00 / 50.00 | 100.00 | Perfecto |
| 0.010 | 49.25 / 50.75 | 98.50 | Excelente |
| 0.020 | 48.50 / 51.50 | 96.99 | Bien |
| 0.045 | 46.62 / 53.38 | 93.23 | Bien |
| 0.090 | 43.24 / 56.76 | 86.48 | Regular |
| 0.180 | 36.60 / 63.40 | 73.20 | Torcido |

Una celda mide 0.182 de ancho. El volumen total de las celdas es 3.5651 contra 3.6024
del elipsoide analítico: **1.0% abajo**, porque son hexaedros rectos inscritos en una
superficie curva.

---

## 4. Decisiones y desvíos

### 4.1 Se recortan tetraedros; clasificar celdas no resuelve

El plan era repartir cada celda según de qué lado caen sus 8 esquinas. **Medido, no
sirve**: las esquinas están en posiciones discretas y el reparto salta de 50/50 a
39/61 en cuanto el plano cruza una capa de partículas. Entre 100 y 78 no hay nada, y
los rangos intermedios no tendrían dónde caer.

| plano | por esquinas | recortando |
|---|---|---|
| +0.045 | 100.0 | 93.2 |
| +0.090 | 78.4 | 86.5 |

Recortando cada tetraedro contra el plano la curva es continua. Los umbrales pedidos
funcionan con este método y no con el otro.

### 4.2 Volumen por celdas, no por la superficie

El pedido original era el teorema de la divergencia sobre la malla cerrada, con
fallback a voxelización si no quedaba estanca. La lattice permite algo exacto y más
simple: cada celda es un hexaedro de 8 esquinas conocidas, y el volumen de una pieza
es la suma. Es estanco por construcción, así que el fallback no hace falta.

### 4.3 El kerf deja de ser un problema

Un corte mata el 9% de las celdas (17% en diagonal), de modo que `V_a + V_b` no podía
dar `V_padre` contando celdas vivas. Midiendo contra el plano eso desaparece: el plano
parte el volumen del padre sin destruir nada.

### 4.4 Identidad de las piezas, que no existía

Los slots de `shapeMatching` se renumeran en cada reconstrucción y mandan las migas a
un centinela compartido, así que no servían para decir «de qué pieza es mitad esta
mitad». `physics/pieces.js` lleva ids estables por herencia mayoritaria.

### 4.5 La medición cuelga del punto por el que pasa todo

Va en `rebuildAfterTopologyChange(plane)`, no dentro de la mecánica: es el único lugar
por el que pasan los dos cortes y el reset. **Solo se puntúa si hay plano**; el tajo
libre barre un cuadrilátero y ahí un reparto no está definido.

### 4.6 Un valor guardado no prueba que medir sea estable

El primer test de V2 releía el puntaje con una espera en el medio, y pasaba **también
con la medición saboteada**: lo que releía era un registro del historial, calculado
una sola vez. Remedir en vivo tampoco discrimina bien, porque los pedazos se alejan
del plano y el número cambia igual (2.9 puntos en cuatro segundos midiendo en reposo,
9.2 midiendo deformado).

Lo que prueba la propiedad es aplastar **un solo lado** sin mover material a través
del plano: AV3.

### 4.7 El «peso» por densidad no se implementó, y por eso no hay bandera

Era opcional y apagado por defecto. Ponderar pulpa y cáscara pide dos densidades, y
cualquier número que pusiera sería inventado. Dejar una bandera de config que no hace
nada es peor que no tenerla: queda anotado en el backlog, con los datos que ya
existen para hacerlo (`faceKind` distingue corteza de pulpa, y el radio en reposo da
la cáscara).

Lo que sí se usa es `VOLUME_TOLERANCE`, para una comprobación cruzada: el volumen del
padre se calcula por dos caminos independientes —el reparto contra el plano y la suma
de celdas repartidas por esquinas— y si discrepan más que la tolerancia, se avisa por
consola bajo `?dev`.

### 4.8 Los tests cortan sin gesto

Dibujar un trazo se lleva decenas de frames y a 10 fps son segundos por corte; tres
cortes en un test dejaban al navegador al borde de caerse. `__dev.cutLine(ax,az,bx,bz)`
corta por una línea de mundo al instante. El gesto se prueba **una vez** (AV11) y el
resto del puntaje se prueba exacto. Bajó tests de minuto y medio a doce segundos.

---

## 5. Trazabilidad

| Requisito | Criterios | Estado |
|---|---|---|
| V1 | AV1, AV2, AV11, AV12 | ✔ |
| V2 | AV3, AV13 | ✔ (el sabotaje lo pone en rojo) |
| V3 | AV4, AV5 | ✔ |
| V4 | AV6 | ✔ |
| V5 | AV7, AV12 | ✔ |
| V6 | AV8 | ✔ |
| V7 | AV9 | ✔ |
| V8 | AV10, AV11 | ✔ |
| V9 | AV17 `[M]` | ✔ a ojo, mirando la captura |
| V10 | AV14 | ✔ |
| V11 | AV16 | ✔ |
| V12 | AV18 `[M]` | ⏳ sin medir con 20 piezas |
| V13 | AV15 | ✔ |
| V14 | AV11 (mouse) · AV19 `[M]` | ⏳ la mano, sin webcam |
| V15 | estructural | ✔ en `config.js` |
