import * as THREE from 'three';
import { MAX_JUICE, FLOOR_Y, tune } from '../config.js';

/** Gotas de jugo: pool de tamaño fijo con swap-remove, dibujado como Points. */
export function createJuice(scene) {
  const jPos  = new Float32Array(MAX_JUICE * 3);
  const jVel  = new Float32Array(MAX_JUICE * 3);
  const jLife = new Float32Array(MAX_JUICE);
  let jCount = 0;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(jPos, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(jLife, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);

  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uPx: { value: 600 } },   // píxeles por unidad de mundo a profundidad 1
    vertexShader: /* glsl */`
      attribute float aLife;
      uniform float uPx;
      varying float vLife;
      void main(){
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp((0.013 + 0.034 * aLife) * uPx / max(0.001, -mv.z), 1.0, 48.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vLife;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = (1.0 - smoothstep(0.26, 0.5, d)) * clamp(vLife, 0.0, 1.0);
        if (a < 0.015) discard;
        vec3 col = mix(vec3(0.80, 0.09, 0.20), vec3(1.0, 0.56, 0.58), smoothstep(0.0, 0.6, vLife));
        gl_FragColor = vec4(col, a * 0.92);
      }
    `,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);

  function spawn(x, y, z, bvx, bvy, n) {
    for (let i = 0; i < n && jCount < MAX_JUICE; i++) {
      const o = jCount * 3;
      jPos[o] = x; jPos[o + 1] = y; jPos[o + 2] = z;
      const sp = 0.5 + Math.random() * 1.3;
      const ang = Math.random() * Math.PI * 2;
      jVel[o]     = bvx * 0.10 + Math.cos(ang) * sp * 0.5;
      jVel[o + 1] = bvy * 0.10 + Math.sin(ang) * sp * 0.5 + 0.55;
      jVel[o + 2] = 0.5 + Math.random() * 1.1;   // salpica hacia el espectador, saliendo del corte
      jLife[jCount] = 0.75 + Math.random() * 0.45;
      jCount++;
    }
  }

  /** Lanza un chorro desde cada punto de corte que reportó el cutter. */
  function burst(cut, blade) {
    const per = 2 + (cut.severed > 60 ? 1 : 0);
    for (let s = 0; s < cut.spawns; s++) {
      spawn(cut.spawnPoints[s * 3], cut.spawnPoints[s * 3 + 1], cut.spawnPoints[s * 3 + 2],
            blade.vx, blade.vy, per);
    }
  }

  function update(dt) {
    for (let i = 0; i < jCount; i++) {
      const o = i * 3;
      jVel[o + 1] += tune.GRAVITY * dt * 0.42;
      jPos[o]     += jVel[o] * dt;
      jPos[o + 1] += jVel[o + 1] * dt;
      jPos[o + 2] += jVel[o + 2] * dt;
      if (jPos[o + 1] < FLOOR_Y + 0.01) {
        jPos[o + 1] = FLOOR_Y + 0.01;
        jVel[o + 1] *= -0.26;
        jVel[o] *= 0.68; jVel[o + 2] *= 0.68;
      }
      jLife[i] -= dt * 0.8;
      if (jLife[i] <= 0) {
        const last = (jCount - 1) * 3;
        jPos[o] = jPos[last]; jPos[o + 1] = jPos[last + 1]; jPos[o + 2] = jPos[last + 2];
        jVel[o] = jVel[last]; jVel[o + 1] = jVel[last + 1]; jVel[o + 2] = jVel[last + 2];
        jLife[i] = jLife[jCount - 1];
        jCount--; i--;
      }
    }
    // Mantener el objeto fuera del render mientras el pool está vacío: si sus
    // buffers GL se crean en un frame con drawRange 0 y datos en cero, el estado
    // cacheado no se recupera nunca y los puntos no se dibujan más.
    points.visible = jCount > 0;
    if (jCount > 0) {
      geo.setDrawRange(0, jCount);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aLife.needsUpdate = true;
    }
  }

  function clear() { jCount = 0; points.visible = false; }

  /** Píxeles por unidad de mundo, para que el tamaño del punto no dependa del DPR. */
  function setPixelScale(renderer, camera) {
    material.uniforms.uPx.value =
      renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  return { points, spawn, burst, update, clear, setPixelScale, get count() { return jCount; } };
}
