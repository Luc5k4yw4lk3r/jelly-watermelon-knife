import * as THREE from 'three';

/**
 * El cuchillo 3D: solo dibujo. La pose la calcula input/blade.js; acá se traduce
 * a una transformación y se manejan el fundido y el destello.
 */
export function createKnife(scene, camera, view) {
  const { knifeParallax, basis, planeToWorld } = view;
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.044, -0.03);
  bladeShape.lineTo(0.048, -0.03);
  bladeShape.lineTo(0.055, 0.52);
  bladeShape.lineTo(0.032, 0.80);
  bladeShape.lineTo(0.000, 0.93);
  bladeShape.lineTo(-0.044, 0.72);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.015, bevelEnabled: true, bevelSize: 0.0035, bevelThickness: 0.0035,
    bevelSegments: 1, curveSegments: 1,
  });
  bladeGeo.translate(0, 0, -0.0075);

  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xe4ebf2, metalness: 0.95, roughness: 0.17,
    emissive: 0xffffff, emissiveIntensity: 0,
    transparent: true, opacity: 1,
  });
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.castShadow = true;
  group.add(bladeMesh);

  const bolsterMat = new THREE.MeshStandardMaterial({ color: 0xaeb6bf, metalness: 0.9, roughness: 0.3, transparent: true });
  const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.055, 0.082), bolsterMat);
  bolster.position.y = -0.055;
  bolster.castShadow = true;
  group.add(bolster);

  const handleMat = new THREE.MeshStandardMaterial({ color: 0x2e2118, metalness: 0.08, roughness: 0.62, transparent: true });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.052, 0.34, 14), handleMat);
  handle.position.y = -0.25;
  handle.rotation.y = Math.PI / 14;
  handle.castShadow = true;
  group.add(handle);

  const capMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.35, transparent: true });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.03, 14), capMat);
  cap.position.y = -0.432;
  group.add(cap);

  const materials = [bladeMat, bolsterMat, handleMat, capMat];

  let flashAmount = 0;

  function flash() { flashAmount = 1; }

  const _p = new THREE.Vector3();
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const _m = new THREE.Matrix4();

  function update(blade, dt) {
    group.visible = blade.opacity > 0.01;
    if (group.visible) {
      // el cuchillo va BLADE_Z más cerca que el plano de corte: escalar su
      // posición respecto de la cámara deja ambos alineados en pantalla
      planeToWorld(blade.x0, blade.y0, 0, _p);
      group.position.lerpVectors(camera.position, _p, knifeParallax);

      // +Y local a lo largo de la hoja, +Z local mirando a la cámara
      _y.set(
        basis.rx * blade.dirx + basis.ux * blade.diry,
        basis.ry * blade.dirx + basis.uy * blade.diry,
        basis.rz * blade.dirx + basis.uz * blade.diry,
      ).normalize();
      _z.set(-basis.fx, -basis.fy, -basis.fz);
      _x.crossVectors(_y, _z).normalize();
      _m.makeBasis(_x, _y, _z);
      group.quaternion.setFromRotationMatrix(_m);

      const sc = 0.85 + 0.15 * blade.opacity;
      group.scale.setScalar(sc * knifeParallax);
      for (let i = 0; i < materials.length; i++) materials[i].opacity = blade.opacity;
    }

    flashAmount *= Math.exp(-dt * 7);
    bladeMat.emissiveIntensity = flashAmount * 1.5;
  }

  return { group, update, flash };
}
