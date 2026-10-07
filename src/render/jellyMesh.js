import * as THREE from 'three';
import { RX, RY, RZ, FLOOR_Y } from '../config.js';
import { KEY_DIR, FILL_DIR } from './scene.js';
import { jellyVertexShader, jellyFragmentShader } from './jelly.glsl.js';

/** Marca un atributo como sucio, subiendo solo el prefijo que está en uso. */
export function markRange(attr, count) {
  attr.needsUpdate = true;
  if (attr.clearUpdateRanges) { attr.clearUpdateRanges(); attr.addUpdateRange(0, count); }
  else if (attr.updateRange) { attr.updateRange.offset = 0; attr.updateRange.count = count; }
}

const SMOOTH_W = 0.8;

export function createJellyMesh(lat, scene) {
  const { N, NFACE, pos, rest, faceCorner, faceKind, nbrP, nbrS, sprAlive } = lat;

  /* La geometría solo dibuja las caras visibles, empaquetadas desde el slot 0,
     así que las subidas por frame quedan chicas aunque el buffer esté reservado
     para todas las caras posibles. */
  const posArr   = new Float32Array(NFACE * 4 * 3);
  const normArr  = new Float32Array(NFACE * 4 * 3);
  const aRestArr = new Float32Array(NFACE * 4 * 3);
  const aKindArr = new Float32Array(NFACE * 4);
  const idxArr   = new Uint32Array(NFACE * 6);
  for (let s = 0; s < NFACE; s++) {
    const v = s * 4, o = s * 6;
    idxArr[o] = v; idxArr[o + 1] = v + 1; idxArr[o + 2] = v + 2;
    idxArr[o + 3] = v; idxArr[o + 4] = v + 2; idxArr[o + 5] = v + 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normArr, 3));
  geo.setAttribute('aRest',    new THREE.BufferAttribute(aRestArr, 3));
  geo.setAttribute('aKind',    new THREE.BufferAttribute(aKindArr, 1));
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uRadii:   { value: new THREE.Vector3(RX, RY, RZ) },
      uKeyDir:  { value: KEY_DIR.clone() },
      uFillDir: { value: FILL_DIR.clone() },
      uFloorY:  { value: FLOOR_Y },
      uTime:    { value: 0 },
    },
    vertexShader: jellyVertexShader,
    fragmentShader: jellyFragmentShader,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  scene.add(mesh);

  /* Un corte diagonal sobre una rejilla alineada a los ejes siempre queda en
     escalera. Un pase Laplaciano sobre las partículas —solo para render, y nunca
     a través de un resorte cortado, para no volver a unir los pedazos— redondea
     la sierra sin tocar la simulación. */
  const smoothPos = new Float32Array(N * 3);

  function smoothPositions() {
    for (let p = 0; p < N; p++) {
      const o = p * 3, b = p * 6;
      let sx = pos[o], sy = pos[o+1], sz = pos[o+2], w = 1;
      for (let d = 0; d < 6; d++) {
        const sp = nbrS[b + d];
        if (sp < 0 || !sprAlive[sp]) continue;
        const q = nbrP[b + d] * 3;
        sx += pos[q]; sy += pos[q+1]; sz += pos[q+2]; w++;
      }
      const iw = SMOOTH_W / w, k = 1 - SMOOTH_W;
      smoothPos[o]   = pos[o]   * k + sx * iw;
      smoothPos[o+1] = pos[o+1] * k + sy * iw;
      smoothPos[o+2] = pos[o+2] * k + sz * iw;
    }
  }

  /* acumuladores de normal separados por tipo: mantienen la corteza suave
     mientras la cara de corte conserva su borde nítido */
  const nRind = new Float32Array(N * 3);
  const nFlesh = new Float32Array(N * 3);

  /** Reescribe los atributos que solo cambian cuando cambia la topología. */
  function rebuild(topo) {
    const { visFace, visCount } = topo;
    for (let s = 0; s < visCount; s++) {
      const f = visFace[s], kind = faceKind[f];
      for (let v = 0; v < 4; v++) {
        const vi = s * 4 + v;
        const p = faceCorner[f * 4 + v] * 3;
        aRestArr[vi * 3]     = rest[p];
        aRestArr[vi * 3 + 1] = rest[p + 1];
        aRestArr[vi * 3 + 2] = rest[p + 2];
        aKindArr[vi] = kind;
      }
    }
    markRange(geo.attributes.aRest, visCount * 12);
    markRange(geo.attributes.aKind, visCount * 4);
    geo.setDrawRange(0, visCount * 6);
  }

  function update(topo) {
    const { visFace, visCount } = topo;
    smoothPositions();
    nRind.fill(0); nFlesh.fill(0);

    for (let s = 0; s < visCount; s++) {
      const f = visFace[s];
      const c0 = faceCorner[f * 4] * 3, c1 = faceCorner[f * 4 + 1] * 3,
            c2 = faceCorner[f * 4 + 2] * 3, c3 = faceCorner[f * 4 + 3] * 3;

      const ux = smoothPos[c1] - smoothPos[c0], uy = smoothPos[c1+1] - smoothPos[c0+1], uz = smoothPos[c1+2] - smoothPos[c0+2];
      const wx = smoothPos[c3] - smoothPos[c0], wy = smoothPos[c3+1] - smoothPos[c0+1], wz = smoothPos[c3+2] - smoothPos[c0+2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;

      const acc = faceKind[f] === 0 ? nRind : nFlesh;
      acc[c0] += nx; acc[c0 + 1] += ny; acc[c0 + 2] += nz;
      acc[c1] += nx; acc[c1 + 1] += ny; acc[c1 + 2] += nz;
      acc[c2] += nx; acc[c2 + 1] += ny; acc[c2 + 2] += nz;
      acc[c3] += nx; acc[c3 + 1] += ny; acc[c3 + 2] += nz;
    }

    for (let s = 0; s < visCount; s++) {
      const f = visFace[s];
      const acc = faceKind[f] === 0 ? nRind : nFlesh;
      for (let v = 0; v < 4; v++) {
        const p = faceCorner[f * 4 + v] * 3;
        const o = (s * 4 + v) * 3;
        posArr[o] = smoothPos[p]; posArr[o + 1] = smoothPos[p + 1]; posArr[o + 2] = smoothPos[p + 2];
        const ax = acc[p], ay = acc[p + 1], az = acc[p + 2];
        const il = 1 / (Math.hypot(ax, ay, az) || 1);
        normArr[o] = ax * il; normArr[o + 1] = ay * il; normArr[o + 2] = az * il;
      }
    }

    markRange(geo.attributes.position, visCount * 12);
    markRange(geo.attributes.normal, visCount * 12);
  }

  return { mesh, material, rebuild, update };
}
