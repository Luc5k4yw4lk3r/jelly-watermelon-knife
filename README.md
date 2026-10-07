# Jelly Watermelon Knife

Una sandía de gelatina con física soft-body propia, que se corta con un cuchillo
3D controlado por tu mano a través de la webcam.

**Mano lenta empuja la gelatina. Tajo rápido la corta de verdad**: rompe los
resortes y separa pedazos que siguen siendo gelatina, tiemblan y caen por
separado.

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

| Gesto | Qué pasa |
|---|---|
| Mano lenta | El cuchillo empuja y aplasta la gelatina |
| Tajo rápido, de punta | Corta y separa pedazos reales |
| Dos manos | Dos cuchillos, cada uno cortando por su cuenta |
| Flechas, botón derecho o dos dedos | Gira la cámara |
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
| `?dev` | expone `window.__dev`: pedazos, telemetría de corte, estado de las hojas, planaridad de la cara de corte y pausa de la simulación |
| `?replay=<url>` | reproduce una sesión de landmarks grabada en lugar de usar la cámara |

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
├── physics/         lattice, solver, shape matching, corte, topología
├── render/          escena, malla de la gelatina, shaders, cuchillo, jugo
├── input/           tracking de mano, One Euro, mouse, órbita, pose de la hoja
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
  en profundidad.
- **MediaPipe** sobre `requestVideoFrameCallback`, nunca dentro del render loop,
  con hasta dos manos. La lógica de landmarks está separada de la cámara, así que
  se puede probar sin hardware y reproducir sesiones grabadas.

La versión larga, con los porqués y los bugs que costaron encontrar, está en
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Lo que falta, con lo que ya se sabe
de cada cosa, en [`docs/BACKLOG.md`](docs/BACKLOG.md).

## Licencia

MIT
