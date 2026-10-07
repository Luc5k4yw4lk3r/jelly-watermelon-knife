/**
 * Órbita de cámara con botón derecho (o dos dedos), y flechas del teclado.
 *
 * El botón izquierdo queda libre: en la mecánica de tajo libre el cuchillo sigue
 * al puntero todo el tiempo, y en la de línea el arrastre izquierdo dibuja. Para
 * quien prefiera el izquierdo, **Shift+izquierdo** también orbita.
 */
const DRAG_SPEED = 0.006;
const KEY_SPEED = 1.6;      // rad/s

export function createOrbit(canvas, orbit) {
  let dragging = false, lastX = 0, lastY = 0;
  const keys = new Set();

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    const withShift = e.button === 0 && e.shiftKey;
    if (e.button !== 2 && e.button !== 1 && !withShift) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    orbit((e.clientX - lastX) * DRAG_SPEED, (e.clientY - lastY) * DRAG_SPEED);
    lastX = e.clientX; lastY = e.clientY;
  });

  // dos dedos: rotar sin interferir con el cuchillo
  let touchX = 0, touchY = 0, twoFinger = false;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) { twoFinger = false; return; }
    twoFinger = true;
    touchX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    touchY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!twoFinger || e.touches.length !== 2) return;
    const x = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const y = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    orbit((x - touchX) * DRAG_SPEED, (y - touchY) * DRAG_SPEED);
    touchX = x; touchY = y;
  }, { passive: true });
  canvas.addEventListener('touchend', () => { twoFinger = false; }, { passive: true });

  addEventListener('keydown', (e) => {
    if (e.key.startsWith('Arrow')) { keys.add(e.key); e.preventDefault(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key));

  /** Las flechas se integran por frame para que el giro sea parejo. */
  function update(dt) {
    if (!keys.size) return;
    const s = KEY_SPEED * dt;
    let da = 0, dp = 0;
    if (keys.has('ArrowLeft')) da -= s;
    if (keys.has('ArrowRight')) da += s;
    if (keys.has('ArrowUp')) dp -= s;
    if (keys.has('ArrowDown')) dp += s;
    if (da || dp) orbit(da, dp);
  }

  return { update };
}
