import * as THREE from 'three';

/**
 * Cuchilla de carnicero: hoja ancha rectangular y mango de madera.
 *
 * Marco local, que es lo que importa para posarla:
 *
 *   +X  a lo largo del filo (se alinea con AB)
 *   −Y  hacia el filo (al apuntar, mira al piso)
 *   +Z  el grosor
 *
 * A diferencia del cuchillo que sigue la mano, esta se coloca en **mundo**: no
 * usa `knifeParallax` ni `planeToWorld`, porque no tiene que coincidir con un
 * plano de pantalla. Los materiales siguen la receta de `knife.js` y reflejan el
 * entorno PMREM de la escena; sin ese entorno una hoja metálica sale negra.
 */
const LEN = 1.15;       // largo del filo
const HEIGHT = 0.40;    // alto de la hoja
const THICK = 0.014;

export function createCleaver(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  /* Perfil en XY: rectángulo con la esquina de arriba y atrás recortada, que es
     lo que hace que se lea como cuchilla y no como una plancha. */
  const shape = new THREE.Shape();
  shape.moveTo(-LEN / 2, 0);
  shape.lineTo(LEN / 2, 0);
  shape.lineTo(LEN / 2, HEIGHT * 0.82);
  shape.lineTo(LEN / 2 - 0.08, HEIGHT);
  shape.lineTo(-LEN / 2, HEIGHT);
  shape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(shape, {
    depth: THICK, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.005,
    bevelSegments: 1, curveSegments: 1,
  });
  bladeGeo.translate(0, 0, -THICK / 2);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xe4ebf2, metalness: 0.95, roughness: 0.17,
    emissive: 0xffffff, emissiveIntensity: 0,
    transparent: true, opacity: 1,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.castShadow = true;
  group.add(blade);

  const bolsterMat = new THREE.MeshStandardMaterial({
    color: 0xaeb6bf, metalness: 0.9, roughness: 0.3, transparent: true,
  });
  const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.065), bolsterMat);
  bolster.position.set(LEN / 2 + 0.03, HEIGHT * 0.5, 0);
  bolster.castShadow = true;
  group.add(bolster);

  const handleMat = new THREE.MeshStandardMaterial({
    color: 0x2e2118, metalness: 0.08, roughness: 0.62, transparent: true,
  });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.36, 14), handleMat);
  handle.rotation.z = Math.PI / 2;        // el eje del mango va sobre X
  handle.position.set(LEN / 2 + 0.25, HEIGHT * 0.5, 0);
  handle.castShadow = true;
  group.add(handle);

  const capMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3ad, metalness: 0.85, roughness: 0.35, transparent: true,
  });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.043, 0.03, 14), capMat);
  cap.rotation.z = Math.PI / 2;
  cap.position.set(LEN / 2 + 0.445, HEIGHT * 0.5, 0);
  cap.castShadow = true;
  group.add(cap);

  const materials = [bladeMat, bolsterMat, handleMat, capMat];

  let flashAmount = 0;
  function flash() { flashAmount = 1; }

  /* Las dos orientaciones entre las que se interpola. En espera la hoja está
     acostada —se ve su cara y la sombra dice a qué altura flota—; al apuntar
     queda de canto, con el filo abajo y el largo sobre AB. */
  const _flat = new THREE.Quaternion();
  const _edge = new THREE.Quaternion();
  const _dir = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _ey = new THREE.Vector3(), _ez = new THREE.Vector3();
  const _fy = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  /**
   * @param {number} dirX   dirección horizontal de AB
   * @param {number} dirZ   idem
   * @param {number} align  0 = acostada, 1 = de canto con el filo abajo
   */
  function setPose(x, y, z, dirX, dirZ, align, opacity) {
    group.position.set(x, y, z);

    _dir.set(dirX, 0, dirZ);
    if (_dir.lengthSq() < 1e-12) _dir.set(1, 0, 0);
    _dir.normalize();

    // de canto: +X sobre AB, +Y arriba, +Z = X × Y, que es la normal del corte
    _ey.copy(_up);
    _ez.crossVectors(_dir, _ey).normalize();
    _m.makeBasis(_dir, _ey, _ez);
    _edge.setFromRotationMatrix(_m);

    // acostada: el grosor (+Z local) mira al cielo, así se ve la cara de la hoja
    _fy.crossVectors(_up, _dir).normalize();
    _m.makeBasis(_dir, _fy, _up);
    _flat.setFromRotationMatrix(_m);

    group.quaternion.slerpQuaternions(_flat, _edge, align);

    group.visible = opacity > 0.01;
    for (let i = 0; i < materials.length; i++) materials[i].opacity = opacity;
  }

  function update(dt) {
    flashAmount *= Math.exp(-dt * 7);
    bladeMat.emissiveIntensity = flashAmount * 1.5;
  }

  return {
    group, setPose, update, flash,
    hide() { group.visible = false; },
    dispose() {
      group.removeFromParent();
      bladeGeo.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
