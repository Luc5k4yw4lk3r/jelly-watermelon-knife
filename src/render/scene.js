import * as THREE from 'three';
import { FLOOR_Y, BLADE_Z } from '../config.js';

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

  /* Órbita alrededor del centro de la escena. El corte vive en el plano que pasa
     por TARGET con la normal mirando a la cámara, así que al orbitar el plano
     acompaña y siempre coincide con lo que se ve. */
  const TARGET = new THREE.Vector3(0, -0.12, 0);
  const ORBIT_RADIUS = 4.474;
  let azimuth = 0, polar = 1.468;        // radianes; polar desde +Y
  const POLAR_MIN = 0.35, POLAR_MAX = 1.92;

  function placeCamera() {
    const sp = Math.sin(polar), cp = Math.cos(polar);
    camera.position.set(
      TARGET.x + ORBIT_RADIUS * sp * Math.sin(azimuth),
      TARGET.y + ORBIT_RADIUS * cp,
      TARGET.z + ORBIT_RADIUS * sp * Math.cos(azimuth),
    );
    camera.lookAt(TARGET);
    camera.updateMatrixWorld();
    updateBasis();
  }

  /* Base de cámara en números planos: la usan los bucles calientes del corte y
     de la colisión, que proyectan cada partícula a coordenadas de pantalla. */
  const basis = {
    rx: 1, ry: 0, rz: 0,      // derecha
    ux: 0, uy: 1, uz: 0,      // arriba
    fx: 0, fy: 0, fz: -1,     // hacia adentro de la escena
    tx: TARGET.x, ty: TARGET.y, tz: TARGET.z,
  };
  const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();

  function updateBasis() {
    _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    _fwd.setFromMatrixColumn(camera.matrixWorld, 2).normalize().negate();
    basis.rx = _right.x; basis.ry = _right.y; basis.rz = _right.z;
    basis.ux = _up.x;    basis.uy = _up.y;    basis.uz = _up.z;
    basis.fx = _fwd.x;   basis.fy = _fwd.y;   basis.fz = _fwd.z;
  }

  placeCamera();

  function orbit(dAzimuth, dPolar) {
    azimuth += dAzimuth;
    polar = Math.min(POLAR_MAX, Math.max(POLAR_MIN, polar + dPolar));
    placeCamera();
  }

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

  /* El cuchillo se dibuja BLADE_Z más cerca que el plano de corte, así que su
     posición se escala respecto de la cámara para que ambos coincidan en
     pantalla hasta el píxel. El radio de órbita es fijo, así que es constante. */
  const knifeParallax = (ORBIT_RADIUS - BLADE_Z) / ORBIT_RADIUS;

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
  /**
   * NDC → coordenadas **del plano de corte** (derecha, arriba de la cámara).
   *
   * Todo el corte y la colisión trabajan en estas dos coordenadas, no en XY del
   * mundo: así la órbita no rompe nada.
   */
  function ndcToPlane(nx, ny, out) {
    _v.set(nx, ny, 0.5).unproject(camera).sub(camera.position);
    const cx = camera.position.x - basis.tx;
    const cy = camera.position.y - basis.ty;
    const cz = camera.position.z - basis.tz;
    const denom = _v.x * basis.fx + _v.y * basis.fy + _v.z * basis.fz;
    const t = -(cx * basis.fx + cy * basis.fy + cz * basis.fz) / (denom || 1e-6);
    const px = cx + _v.x * t, py = cy + _v.y * t, pz = cz + _v.z * t;
    out.x = px * basis.rx + py * basis.ry + pz * basis.rz;
    out.y = px * basis.ux + py * basis.uy + pz * basis.uz;
    return out;
  }

  /** Coordenadas del plano → punto de mundo, a `depth` unidades hacia la cámara. */
  function planeToWorld(a, b, depth, out) {
    out.x = basis.tx + basis.rx * a + basis.ux * b - basis.fx * depth;
    out.y = basis.ty + basis.ry * a + basis.uy * b - basis.fy * depth;
    out.z = basis.tz + basis.rz * a + basis.uz * b - basis.fz * depth;
    return out;
  }

  function render() {
    renderer.render(scene, camera);
  }

  return {
    renderer, scene, camera, knifeParallax, basis, orbit,
    resize, onResize, adaptResolution, ndcToPlane, planeToWorld, render,
  };
}
