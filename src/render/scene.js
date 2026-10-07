import * as THREE from 'three';
import { FLOOR_Y, PLANE_Z, BLADE_Z } from '../config.js';

export const KEY_DIR = new THREE.Vector3(3.2, 5.6, 3.4).normalize();
export const FILL_DIR = new THREE.Vector3(-0.55, 0.3, -0.5).normalize();

/* Entorno de estudio procedural diminuto. Sin esto, una hoja con metalness 0.95
   no tiene nada que reflejar y se renderiza negra. */
function buildEnvironment(renderer, scene) {
  const W = 64, H = 32;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    // cielo -> horizonte -> piso, más una banda brillante tipo softbox arriba
    let l = 0.30 + 0.62 * Math.pow(1 - v, 1.1);
    const box = Math.exp(-Math.pow((v - 0.17) / 0.085, 2));
    l += box * 0.85;
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      const side = 0.9 + 0.22 * Math.cos((u - 0.3) * Math.PI * 2);
      const c = Math.min(1, l * side);
      const o = (y * W + x) * 4;
      data[o]     = Math.round(255 * Math.min(1, c * 0.99));
      data[o + 1] = Math.round(255 * Math.min(1, c * 1.00));
      data[o + 2] = Math.round(255 * Math.min(1, c * 0.97));
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
  });
  let pixelRatio = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.set(0, 0.34, 4.45);
  camera.lookAt(0, -0.12, 0);

  /* luces: la direccional alimenta el shadow map; el shader de la gelatina hace
     su propio sombreado con direcciones equivalentes (más barato y con más
     control) */
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.copy(KEY_DIR).multiplyScalar(8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2.6; key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;   key.shadow.camera.bottom = -2.6;
  key.shadow.camera.near = 1;    key.shadow.camera.far = 20;
  key.shadow.radius = 4;
  key.shadow.bias = -0.0012;
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  buildEnvironment(renderer, scene);

  /* piso de estudio: solo sombra, para que se vea el degradado del CSS */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ color: 0x24341f, opacity: 0.26 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y - 0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  /* El cuchillo se dibuja a BLADE_Z pero el corte ocurre en PLANE_Z, así que su
     posición se escala respecto de la cámara para que ambos coincidan en
     pantalla hasta el píxel. */
  const knifeParallax = (camera.position.z - BLADE_Z) / (camera.position.z - PLANE_Z);

  const onResize = [];
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of onResize) fn(renderer, camera);
  }

  /** El fragment shader es lo caro: antes de perder frames, se baja resolución. */
  let slowFrames = 0;
  function adaptResolution(fpsEma) {
    if (pixelRatio > 1 && fpsEma < 48) {
      if (++slowFrames > 90) {
        pixelRatio = pixelRatio > 1.4 ? 1.4 : 1;
        renderer.setPixelRatio(pixelRatio);
        resize();
        slowFrames = 0;
        return true;
      }
    } else if (slowFrames > 0) slowFrames--;
    return false;
  }

  const _v = new THREE.Vector3();
  /** NDC → punto del plano de corte, en coordenadas de mundo. */
  function ndcToPlane(nx, ny, out) {
    _v.set(nx, ny, 0.5).unproject(camera).sub(camera.position);
    const t = (PLANE_Z - camera.position.z) / _v.z;
    out.x = camera.position.x + _v.x * t;
    out.y = camera.position.y + _v.y * t;
    return out;
  }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, knifeParallax,
    resize, onResize, adaptResolution, ndcToPlane, render,
  };
}
