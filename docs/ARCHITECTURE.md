# Arquitectura

Notas de diseño y, sobre todo, las cosas que no son obvias y costaron encontrar.

## El pipeline de build existe por una sola razón

El entregable es *un archivo que se abre con doble clic*. Chrome trata las
páginas `file://` como **origen opaco** y bloquea los `import` **relativos** entre
archivos:

```
Access to script at 'file:///.../physics/solver.js' from origin 'null'
has been blocked by CORS policy
```

Los imports de **CDN por https** sí funcionan desde `file://` (jsdelivr manda
`access-control-allow-origin: *`), que es como andaba el prototipo original. Pero
servir módulos locales tal cual rompe el doble clic. De ahí Vite +
`vite-plugin-singlefile`: se escribe en módulos y se emite un `dist/index.html`
autocontenido.

`three` se bundlea desde npm. MediaPipe queda en el CDN con `import()` dinámico,
porque su WASM y su modelo de 7.8 MB se bajan en runtime igual.

## Física

### Por qué hay shape matching y no solo resortes

La lattice es de 12×10×12 (1440 partículas) mapeada **cubo→esfera**, lo que da un
elipsoide liso sin escalera de vóxeles ni partículas recortadas. Los ~15.5k
resortes son estructurales, de shear y de flexión, resueltos con relajación de
Gauss-Seidel sobre integración de Verlet.

Con eso solo, **la sandía se despanzurra**. Con 2 o 3 iteraciones de relajación la
rigidez se propaga apenas 2 o 3 celdas por frame, y la lattice tiene 10 capas de
alto: el error nunca llega del polo al piso. Subir las iteraciones lo suficiente
cuesta más que todo el resto del frame junto.

La solución es **shape matching** (Müller et al.): se calcula la transformación
óptima que lleva la forma de reposo de cada pedazo a su forma actual y se tira de
cada partícula hacia ese objetivo. Es O(N) y, además de resolver la rigidez,
resuelve gratis un problema que venía después: cada pedazo que se desprende
obtiene automáticamente su propia forma de reposo, porque las componentes conexas
se recalculan en cada corte.

**La descomposición polar hay que normalizarla.** La iteración de Newton
`R ← (R + R⁻ᵀ)/2` solo divide la escala a la mitad por vuelta. `Apq` tiene
magnitud del orden de N (~400), así que 8 iteraciones la dejan en ~1.6: el
resultado no es una rotación, es una rotación con un factor de escala de 1.7
adentro. El síntoma era espectacular y desconcertante — la gelatina se inflaba un
50% y giraba sola. Dividir por la norma de Frobenius antes de iterar lo arregla.

### Giro parásito

Un orden de barrido Gauss-Seidel fijo es direccional e inyecta momento angular de
a poco. Se corrige con dos cosas: alternar el sentido del barrido en cada
iteración, y drenar explícitamente el giro de cuerpo rígido de cada componente
(`ω = I⁻¹L`, se resta una fracción). Sin eso la sandía rota ~3°/s para siempre.

## Corte

El corte es **topológico**, no un empujón: se eliminan los resortes cuyo segmento
cruza el área que barrió la hoja entre el frame anterior y el actual.

### El cuchillo corta de punta

Esto no es cosmético, es lo que hace que el corte funcione.

Si la hoja se mueve **perpendicular a su propio eje**, el área barrida es un
rectángulo tan ancho como larga la hoja (0.92 × el desplazamiento). Cortar todos
los resortes de adentro no rebana: **excava**. La primera versión del fallback a
mouse apuntaba la hoja perpendicular al movimiento y el resultado era media sandía
convertida en polvo.

Viajando **sobre su propio eje**, el barrido es una astilla fina y el corte es un
plano limpio. De ahí tres defensas:

- El mouse apunta la hoja hacia donde va.
- `MAX_KERF` acota la componente lateral del barrido a una ranura de cuchillo, por
  si el movimiento no es perfectamente axial.
- `MAX_CUT_ROT` veta el corte mientras la hoja gira rápido. Sin esto, una mano
  temblorosa (o un giro de 180° al arrancar un swipe) barre un abanico y pica
  todo. Por eso también la dirección **salta** en los giros bruscos en vez de
  interpolar: hacer easing a través de 180° es exactamente el caso malo.

### Cómo aparece la pulpa roja

No se genera geometría nueva. La malla tiene **todas** las caras de **todas** las
celdas pre-construidas, y solo se dibujan las visibles. Una celda muere si pierde
cualquiera de sus 12 aristas estructurales, así que el corte se lleva la capa de
celdas que atraviesa; las caras de las celdas vecinas que quedan sin par pasan a
ser visibles. Las caras interiores ya venían marcadas como pulpa, y el shader las
colorea por radio: rojo con semillas, anillo de blanco, corteza verde.

Las caras visibles se empaquetan desde el slot 0 para que cada frame solo haya que
subir ese prefijo del buffer.

### El corte vive en espacio de cámara

El prisma del corte **no** va por el eje Z del mundo: las partículas se proyectan
a la base de la cámara (derecha / arriba / profundidad) y el prisma se extiende
sobre el eje de visión. El test 2D del swept quad es idéntico; lo único que
cambia es la base.

Esto es lo que permite orbitar sin que el plano de corte deje de coincidir con lo
que se ve, y de paso habilita cortar un pedazo en profundidad.

### Suavizado de la cara de corte

Un corte diagonal sobre una rejilla alineada a los ejes siempre queda en escalera.
Un pase Laplaciano sobre las partículas —**solo para render**, y nunca a través de
un resorte cortado, para no volver a pegar los pedazos— redondea la sierra sin
tocar la simulación.

### Dos intentos de aplanar la cara de corte, los dos medidos y descartados

La silueta escalonada del corte molesta. Se probaron dos enfoques y **los dos
empeoraron** la métrica, así que no están en el código. Vale dejarlos anotados
para no repetirlos.

La métrica: alineación de las normales de las caras de pulpa visibles contra su
promedio (1.0 = cara perfectamente plana).

**1. Proyectar las partículas del borde sobre el plano de la hoja.** Al cortar se
conoce el plano exacto, así que se proyectaban sobre él las partículas que
perdieron un resorte, grabando la corrección también en `rest` para que el shape
matching no la deshiciera.

| Rango de aplanado | Alineación media |
|---|---|
| 0 (control) | 0.56 |
| 0.12 | 0.545 |
| 0.20 | 0.385 |

Monótonamente peor. La razón: la escalera la produce **qué celdas sobreviven**,
no dónde están las partículas. Las caras expuestas son caras de celda, y mover
solo las partículas tocadas mientras sus vecinas quedan quietas **inclina** esas
caras en direcciones inconsistentes: agrega ruido en vez de sacar escalones.

Además tenía un modo de falla propio: un tajo dura ~18 frames y la misma
partícula se re-aplanaba contra una recta distinta en cada uno, acumulando deriva
en `rest` hasta destruir la forma objetivo del shape matching. La sandía se
desintegraba en 8 pedazos donde el control daba 2.

**2. Suavizado Laplaciano a lo largo de la propia superficie de corte.** Pases
extra de suavizado solo entre partículas de la cara, sin tocar el interior.
Resultado errático y no monótono (0.93 control → 0.12 con 2 pases → 0.55 con 3 →
0.86 con 5): con peso alto la superficie se encoge sobre sí misma y las normales
se vuelven basura.

**Lo que dejó la medición:** el control ya puntúa **0.926** de alineación, con el
82% de las caras dentro de 30°. Las normales de la cara de corte ya están bien;
lo que se ve feo es la **silueta**, que es geometría, no sombreado. Arreglarla de
verdad requiere geometría sub-celda —partir las celdas en el plano de corte y
generar polígonos nuevos— o una lattice bastante más fina. Cualquier otra cosa es
mover ruido de lugar.

**La métrica buena es otra.** La alineación de normales no sirve para esto porque
las normales ya están suavizadas. Lo que hay que medir es **planaridad**: el RMS
de la distancia de los vértices de la cara al plano de mejor ajuste. Está en
`window.__dev.cutFacePlanarity()` con `?dev`, y devuelve dos números:

- `rms`, sobre la malla tal como se dibuja. Es el que importa, pero incluye el
  bamboleo de la gelatina y varía entre 0.2 y 0.4 corrida a corrida.
- `restRms`, sobre las posiciones de reposo. Mide solo la escalera geométrica:
  sale **0.084** de forma determinista, que es media celda de la lattice (0.18) —
  exactamente la amplitud del escalón.

**0.084 es la línea base.** Una cara realmente plana debería dar por debajo de
0.02.

## Render

El shader de la gelatina hace su propio sombreado en vez de usar un material de
three: es más barato y da más control. Franjas onduladas por meridiano, pulpa con
degradado radial, semillas procedurales, fresnel y difusión wrap como subsurface
falso. El texturizado usa `aRest` (la posición de reposo), no la deformada, así los
dibujos no nadan sobre la superficie cuando tiembla.

Las normales se acumulan **por tipo de cara** (corteza / pulpa) para que el borde
entre la cáscara y el corte quede nítido en vez de redondearse.

## Bugs que vale la pena recordar

**Un `dt` recortado para un subsistema corrompe a cualquier otro que lo lea.** El
frame loop recorta `dt` a 0.1 s para que la física no explote después de un stall,
y la velocidad de la hoja se calculaba con ese valor recortado. En una máquina a
5 fps un movimiento de 2 u/s se medía como 4 y disparaba cortes espurios: **mover
la mano despacio cortaba**. Solo se manifiesta a fps bajos, que es justo donde más
molesta. La velocidad de entrada ahora va contra el tiempo real del frame
(`speedDt` en `input/blade.js`); el `dt` recortado se usa solo para suavizado y
para la física.

Lo transferible: un clamp puesto por la estabilidad de un subsistema se vuelve
mentira para todos los demás que lean esa variable. Si un número se recorta por una
razón, hay que preguntarse quién más lo está leyendo.

**El `<canvas>` es un elemento reemplazado.** `position: fixed; inset: 0` **no** lo
estira: toma su tamaño intrínseco, que es el del drawing buffer. Con
`devicePixelRatio 2` eso significa dibujar la escena al doble de tamaño y
desplazada fuera de cuadro. Con DPR 1 coincide por casualidad y no se nota. Hace
falta `width: 100%; height: 100%` explícito.

**Un buffer GL creado vacío puede quedar envenenado.** Las partículas de jugo no
se dibujaban nunca, pese a que `renderer.info.render.points` reportaba la cantidad
correcta y los datos en CPU estaban bien. La causa: el buffer se creaba en el
primer frame, cuando `drawRange` era 0 y el array estaba en cero, y ese estado
cacheado no se recuperaba nunca — ni subiendo el buffer entero, ni cambiando de
material. `geometry.dispose()` lo arreglaba, lo que confirmó el diagnóstico. La
solución real es mantener el objeto con `visible = false` mientras el pool está
vacío, así sus buffers se crean en un frame que sí tiene datos.

## Tracking

MediaPipe Tasks Vision con delegate GPU (con fallback a CPU si el driver lo
rechaza), corriendo sobre `requestVideoFrameCallback`. Eso importa:
`detectForVideo` es **sincrónico** y tarda varios ms, así que llamarlo dentro del
render loop bloquearía un frame cada vez. Sobre rVFC corre al ritmo de la cámara,
desacoplado del render.

Los 21 landmarks se suavizan con un filtro One Euro, que saca el jitter sin meter
el retardo que un promedio móvil agregaría en los movimientos rápidos.

La hoja se posiciona con el punto medio muñeca–nudillo del índice y se orienta con
ese mismo vector. La X se espeja para que mover la mano a la derecha mueva el
cuchillo a la derecha.

Se trackean **dos manos**, cada una con su propio banco de filtros. Los slots se
asignan por la *handedness* que reporta MediaPipe, no por el orden del array: ese
orden no es estable entre frames y los cuchillos terminan intercambiándose solos.

## Cómo se prueba esto

La lógica de tracking vive en `input/handPose.js`, **sin DOM ni MediaPipe**:
asignación de slots por handedness, One Euro, pérdida y reaparición de la mano.
`input/handTracking.js` queda como cáscara de hardware. Esa separación es lo que
hace que lo único realmente frágil del tracking se pueda probar en Node, sin
navegador ni cámara.

Encima de eso hay un **replay**: `?replay=<url>` alimenta el mismo `handPose` con
landmarks grabados. El grabador está en el panel de tuneo (`D`) y guarda los
landmarks **crudos**, pre-One-Euro, para que el filtro quede bajo test y no se dé
por buena su salida.

El detalle que hace al replay útil: avanza **un frame grabado por frame
renderizado**, no por reloj de pared, y le pasa a la hoja el `dt` **grabado** para
calcular la velocidad. Si avanzara por tiempo real, en una máquina que renderiza
más lento que la grabación el replay entero se consume entre dos frames — que es
exactamente lo que pasaba en la primera versión.

### Dos cosas que hay que saber antes de escribir un test acá

**Las velocidades van en unidades de mundo por segundo, no en píxeles por frame.**
El umbral de corte está en esas unidades y el navegador de CI renderiza por
software a pocos fps: el mismo gesto en píxeles por frame da velocidades
completamente distintas según la máquina.

**Los tests corren en serie.** Varias instancias WebGL por software compitiendo se
roban CPU entre sí, los fps colapsan y los barridos se quedan sin frames: la suite
fallaba en paralelo y pasaba de a un test.

Y un límite honesto: el replay fija la **entrada**, no la simulación. La física
avanza por pasos fijos acumulados contra tiempo real, así que cuántos substeps
caen entre dos frames depende de la máquina y el corte varía unos pocos resortes.
Por eso las aserciones exactas van sobre `restRms` (posiciones de reposo, sin
deformación) y no sobre números que dependan del bamboleo.

### El framerate bajo del entorno de test es un detector, no un estorbo

El navegador de los tests renderiza por software a pocos fps. La primera reacción
fue pelearlo; la correcta fue darse cuenta de que **expone bugs que a 60 fps no se
ven**. El del `dt` recortado apareció ahí, en el primer run completo de la suite, y
afecta a cualquier usuario con una máquina lenta.

## Cómo se decide si una mejora de calidad sirve

En este proyecto se mergearon cero mejoras de calidad sin número, y se revirtieron
dos que parecían obviamente buenas. El procedimiento que quedó:

**1. Definir la métrica antes de tocar nada, y elegir la correcta.** La alineación
de normales parecía la métrica natural para la cara de corte y resultó inútil: ya
puntuaba 0.926 porque las normales están suavizadas, mientras la silueta seguía en
escalera. La métrica buena era la **planaridad** de los vértices. Una métrica que no
distingue el problema del no-problema hace perder más tiempo que no medir.

**2. Medir la línea base, y que sea determinista.** `restRms` se mide sobre
posiciones de reposo justamente para que no entre el bamboleo de la gelatina: da
0.084 idéntico corrida a corrida. Una línea base ruidosa no deja comparar nada.

**3. Medir después, y aceptar el resultado.** Los dos intentos de aplanar la cara
empeoraron la métrica de forma monótona. Quedaron documentados con sus números en
vez de mergeados con buena intención.

### Un test que nunca falló no demostró nada

Antes de dar por buena la suite se rompió el código a propósito para ver si se
ponía en rojo. De tres sabotajes, dos funcionaron y **uno reveló algo más útil que
si hubiera fallado**: la trampa del buffer GL vacío ya no se reproduce, porque ese
bug necesitaba dos condiciones y una de ellas —las subidas parciales— no existe más
en el código. Está anotado en [BACKLOG.md](BACKLOG.md) en vez de fingir cobertura.

El primer sabotaje también enseñó algo: el test de HiDPI **pasaba con el bug
puesto**, porque Playwright corre con `deviceScaleFactor: 1` y con DPR 1 el buffer
coincide con el CSS por casualidad. Un test que no reproduce la condición del bug
es decoración.

## Performance

~2.3 ms por paso de física en una laptop normal. El resto es GPU: el fragment
shader es lo caro. Antes de perder frames se baja la resolución (`adaptResolution`)
en vez de dejar caer los fps.
