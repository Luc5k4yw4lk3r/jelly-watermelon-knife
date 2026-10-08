import * as THREE from 'three';
import { markRange } from './jellyMesh.js';
import { createCutGeometry } from '../physics/cutGeometry.js';

/**
 * La cara de corte, dibujada sobre el plano en vez de en escalera.
 *
 * Malla propia, con el **mismo material** que la gelatina: el shader pide
 * `position`, `normal`, `aRest` y `aKind`, y con eso solo ya pinta el degradado
 * radial, el anillo de cáscara y las semillas. La sección trae su `aRest` de
 * verdad —la posición de reposo del punto donde el plano cruzó la arista—, así
 * que el dibujo de la pulpa cae donde corresponde sin una línea de GLSL nueva.
 *
 * La geometría y la decisión de dónde va cada vértice viven en
 * `physics/cutGeometry.js`, que es puro y se mide en Node. Acá queda lo que
 * necesita GPU: buffers, índices y normales.
 */
export function createCutFaces(lat, scene, material) {
  const geo = createCutGeometry(lat);

  const MAX_VERT = geo.vRest.length / 3;
  const MAX_TRI = MAX_VERT;                 // un abanico deja n−2 triángulos

  const posArr = new Float32Array(MAX_VERT * 3);
  const normArr = new Float32Array(MAX_VERT * 3);
  const aRestArr = new Float32Array(MAX_VERT * 3);
  const aKindArr = new Float32Array(MAX_VERT);
  const idxArr = new Uint32Array(MAX_TRI * 3);

  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  bg.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
  bg.setAttribute('aRest', new THREE.BufferAttribute(aRestArr, 3));
  bg.setAttribute('aKind', new THREE.BufferAttribute(aKindArr, 1));
  bg.setIndex(new THREE.BufferAttribute(idxArr, 1));
  bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6);
  bg.setDrawRange(0, 0);

  const mesh = new THREE.Mesh(bg, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  /* Sin vértices, con `drawRange` en 0 y los buffers en cero, el estado del
     objeto queda envenenado y no se recupera nunca: la misma trampa que ya
     costó cara con las gotas de jugo. */
  mesh.visible = false;
  scene.add(mesh);

  let nTri = 0;

  /** Rehace la cara a partir de un corte por plano. */
  function rebuild(plane, topo) {
    geo.rebuild(plane, topo);
    nTri = 0;

    for (let p = 0; p < geo.nPoly; p++) {
      const s = geo.polyStart[p], n = geo.polyLen[p];
      /* La sección del lado + mira hacia donde se fue el otro, así que su
         bobinado es el opuesto al que `capPolygon` entrega alrededor de la
         normal del plano; al revés queda de espaldas y el culling se la come.
         Las paredes conservan el bobinado de la cara que recortan, que ya mira
         hacia afuera de la fruta. */
      const flip = geo.polyIsSection[p] && geo.polySide[p] > 0;
      for (let i = 1; i < n - 1; i++) {
        const o = nTri * 3;
        idxArr[o] = s;
        idxArr[o + 1] = s + (flip ? i + 1 : i);
        idxArr[o + 2] = s + (flip ? i : i + 1);
        nTri++;
      }
      for (let i = 0; i < n; i++) {
        const v = s + i, o = v * 3, r = v * 3;
        aRestArr[o] = geo.vRest[r];
        aRestArr[o + 1] = geo.vRest[r + 1];
        aRestArr[o + 2] = geo.vRest[r + 2];
        /* La pared de afuera va como corteza: es lo que hace que el verde
           llegue hasta el plano en vez de cortarse media celda antes. */
        aKindArr[v] = geo.polyKind[p];
      }
    }

    markRange(bg.attributes.aRest, geo.nVert * 3);
    markRange(bg.attributes.aKind, geo.nVert);
    markRange(bg.index, nTri * 3);
    bg.setDrawRange(0, nTri * 3);
    mesh.visible = nTri > 0;
  }

  /** Recoloca los vértices del frame y rehace las normales por polígono. */
  function update(shape, src) {
    if (!nTri) return;
    geo.update(shape, src);
    posArr.set(geo.vPos.subarray(0, geo.nVert * 3));

    for (let p = 0; p < geo.nPoly; p++) {
      const s = geo.polyStart[p], n = geo.polyLen[p];
      /* Normal plana, no acumulada por vértice: la sección tiene que verse
         plana y con el borde nítido contra la corteza, que es la misma razón
         por la que la malla de la gelatina separa sus dos acumuladores. */
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < n; i++) {
        const a = (s + i) * 3, b = (s + (i + 1) % n) * 3;
        nx += (posArr[a + 1] - posArr[b + 1]) * (posArr[a + 2] + posArr[b + 2]);
        ny += (posArr[a + 2] - posArr[b + 2]) * (posArr[a] + posArr[b]);
        nz += (posArr[a] - posArr[b]) * (posArr[a + 1] + posArr[b + 1]);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const sg = geo.polyIsSection[p] && geo.polySide[p] > 0 ? -1 : 1;
      nx = (nx / l) * sg; ny = (ny / l) * sg; nz = (nz / l) * sg;
      for (let i = 0; i < n; i++) {
        const o = (s + i) * 3;
        normArr[o] = nx; normArr[o + 1] = ny; normArr[o + 2] = nz;
      }
    }

    markRange(bg.attributes.position, geo.nVert * 3);
    markRange(bg.attributes.normal, geo.nVert * 3);
  }

  /** Vuelve a no tener cara: la sandía nueva no hereda la del corte anterior. */
  function clear() {
    nTri = 0;
    bg.setDrawRange(0, 0);
    mesh.visible = false;
  }

  return {
    mesh, rebuild, update, clear,
    sectionRest: geo.sectionRest,
    /** La sección tal como se dibuja, para medirla sobre lo que se ve. */
    renderPositions: () => posArr.subarray(0, geo.nVert * 3),
    get stats() { return { polys: geo.nPoly, verts: geo.nVert, tris: nTri }; },
  };
}
