# Jelly Watermelon Knife

Una sandía de gelatina con física soft-body propia, que se corta con cuchillos 3D
controlados por tu mano a través de la webcam.

Dos formas de cortar, a elección:

- **Tajo libre** — el cuchillo sigue tu mano todo el tiempo. *Mano lenta empuja la
  gelatina; tajo rápido la corta de verdad.* Es un gesto de destreza.
- **Cuchillo** — dibujás una línea sobre la fruta y una cuchilla de carnicero baja
  y parte por ahí. Sin umbral de velocidad: corta exactamente donde apuntaste.

En las dos, el corte rompe resortes y separa pedazos que siguen siendo gelatina,
tiemblan y caen por separado.

Sin motor de física, sin librería de partículas: lattice de resortes con
integración de Verlet, shape matching por componente conexa y corte por topología,
todo a mano en typed arrays.

## Probarlo

- **En el navegador:** abrí la demo (ver *Deployments* del repo).
- **Offline:** bajá el `index.html` de la última
  [release](../../releases/latest) y abrilo con doble clic. Es un archivo
  autocontenido; lo único que pide por red es el modelo de MediaPipe, y solo si
  activás la cámara.

La cámara se procesa 100% en tu máquina. Si no hay permisos o no hay cámara, el
cuchillo cae automáticamente al mouse y todo lo demás funciona igual.

## Cómo se usa

Elegí la mecánica en el chip **Mecánica** del HUD; se cambia en caliente y los
pedazos que ya cortaste se conservan.

**Tajo libre**

| Gesto | Qué pasa |
|---|---|
| Mano lenta | El cuchillo empuja y aplasta la gelatina |
| Tajo rápido, de punta | Corta y separa pedazos reales |
| Dos manos | Dos cuchillos, cada uno cortando por su cuenta |

**Cuchillo**

| Gesto | Qué pasa |
|---|---|
| Arrastrar y soltar | Dibuja la línea y la cuchilla baja a partir por ahí |
| Pinza de pulgar e índice | Lo mismo, con la mano |
| Línea muy corta, o `Esc` | Cancela, la cuchilla vuelve arriba |

**En las dos**

| Gesto | Qué pasa |
|---|---|
| Flechas, botón derecho, `Shift`+izquierdo o dos dedos | Gira la cámara |
| `D` | Panel de tuneo en vivo |
| `R` o *Reset sandía* | Sandía nueva |

El cuchillo corta **de punta**: tiene que viajar sobre su propio eje. Moverlo de
costado lo convierte en un garrote, no en un cuchillo — que es exactamente lo que
pasaría con un cuchillo de verdad.

## Desarrollo

```bash
pnpm install
pnpm dev        # servidor de desarrollo con HMR
pnpm build      # -> dist/index.html, un solo archivo autocontenido
pnpm preview    # sirve el build
pnpm test                 # toda la suite
pnpm test --project=node  # solo los unitarios, sin navegador (rápido)
pnpm test -g "reset"      # un test puntual, por nombre
```

Dos banderas de URL, solo para desarrollo:

| | |
|---|---|
| `?dev` | expone `window.__dev`: pedazos, telemetría de corte, estado de las hojas y de la mecánica, componentes conexas, planaridad de la cara de corte y pausa de la simulación |
| `?replay=<url>` | reproduce una sesión de landmarks grabada en lugar de usar la cámara |
| `?mech=<id>` | arranca en una mecánica: `handKnife` o `lineKnife` |

Para grabar una sesión: abrí el panel de tuneo con `D`, activá la cámara y tocá
**Grabar landmarks**. Baja un JSON que sirve tanto para los tests como para
reproducir a mano algo que pasó una sola vez.

El código vive en `src/`, en módulos por dominio. El build vuelve a empaquetarlo
todo en un archivo porque Chrome bloquea los `import` relativos desde `file://`, y
poder abrirlo con doble clic es parte del punto. Está explicado en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
src/
├── config.js        constantes estructurales + `tune` ajustable en vivo
├── main.js          cableado y frame loop
├── mechanics/       las dos formas de cortar, detrás de una interfaz común
├── physics/         lattice, solver, shape matching, corte, topología, impulsos
├── render/          escena, malla de la gelatina, shaders, cuchillos, jugo
├── input/           tracking de mano, One Euro, mouse, puntero, órbita, pose
├── audio/           squish sintetizado con WebAudio
└── ui/              HUD, overlay y panel de tuneo
```

## Cómo funciona

La versión corta:

- **Lattice** de 12×10×12 partículas mapeada cubo→esfera, unidas por ~15.5k
  resortes estructurales, de shear y de flexión.
- **Shape matching** por componente conexa, porque la relajación de resortes sola
  no propaga rigidez a través de 10 capas y la sandía se despanzurra.
- **Corte topológico**: se eliminan los resortes que cruzan el área barrida por la
  hoja. Los pedazos resultantes son cuerpos independientes de verdad.
- **Corte en espacio de cámara**, así que la órbita no lo rompe y se puede cortar
  en profundidad. La cuchilla de línea reusa el mismo cutter con una base
  sintética: derecha sobre la línea, arriba el +Y del mundo, y el eje que el
  cutter ignora pasa a ser la normal del plano vertical.
- **MediaPipe** sobre `requestVideoFrameCallback`, nunca dentro del render loop,
  con hasta dos manos. La lógica de landmarks está separada de la cámara, así que
  se puede probar sin hardware y reproducir sesiones grabadas.

La mecánica «Cuchillo» tiene su spec en
[`docs/specs/cuchillo-de-linea.md`](docs/specs/cuchillo-de-linea.md): requisitos
numerados, el test que prueba cada uno, y lo que la medición obligó a cambiar.

La versión larga, con los porqués y los bugs que costaron encontrar, está en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Lo que falta, con lo que ya se sabe
de cada cosa, en [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Licencia

MIT
