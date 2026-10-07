/**
 * Shader de la gelatina.
 *
 * Hace su propio sombreado en vez de apoyarse en un material de three: franjas
 * onduladas por meridiano en la corteza, pulpa con degradado radial, anillo de
 * blanco, semillas procedurales, fresnel y difusión wrap como subsurface falso.
 *
 * El texturizado usa `aRest` (la posición de reposo), no la deformada: así los
 * dibujos no nadan sobre la superficie cuando la gelatina tiembla.
 */

export const jellyVertexShader = /* glsl */`
    attribute vec3 aRest;
    attribute float aKind;
    varying vec3 vRest;
    varying float vKind;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vW;
    void main(){
      vRest = aRest;
      vKind = aKind;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

export const jellyFragmentShader = /* glsl */`
    precision highp float;
    uniform vec3 uRadii;
    uniform vec3 uKeyDir;
    uniform vec3 uFillDir;
    uniform float uFloorY;
    varying vec3 vRest;
    varying float vKind;
    varying vec3 vN;
    varying vec3 vV;
    varying vec3 vW;

    float hash31(vec3 p){
      p = fract(p * vec3(0.1031, 0.1030, 0.0973));
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float fnoise(vec3 p){
      vec3 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float n000 = hash31(i), n100 = hash31(i + vec3(1,0,0));
      float n010 = hash31(i + vec3(0,1,0)), n110 = hash31(i + vec3(1,1,0));
      float n001 = hash31(i + vec3(0,0,1)), n101 = hash31(i + vec3(1,0,1));
      float n011 = hash31(i + vec3(0,1,1)), n111 = hash31(i + vec3(1,1,1));
      return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
                 mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
    }

    void main(){
      vec3 nr = vRest / uRadii;          // unit-sphere coords, stable under deformation
      float r = length(nr);

      vec3 base;
      vec3 sss;            // subsurface tint pushed by back/wrap light
      float gloss, rimAmt;

      if (vKind < 0.5) {
        /* ---- outer rind: dark green with wavy meridian stripes ---- */
        float a = atan(nr.z, nr.x);
        float wob = 0.52 * sin(nr.y * 4.1 + 0.9) + 0.16 * sin(nr.y * 9.3);
        float s = sin(a * 7.0 + wob);
        float band = smoothstep(-0.14, 0.30, s);
        vec3 dark  = vec3(0.055, 0.205, 0.088);
        vec3 light = vec3(0.235, 0.510, 0.210);
        base = mix(dark, light, band);
        base *= 0.90 + 0.20 * fnoise(vRest * 11.0);
        // slight sheen toward the top of the fruit
        base += 0.05 * smoothstep(0.2, 1.0, nr.y);
        sss = vec3(0.30, 0.55, 0.22);
        gloss = 68.0; rimAmt = 0.34;
      } else {
        /* ---- cut surface: pale pith ring + red flesh + black seeds ---- */
        vec3 flesh = mix(vec3(0.760, 0.055, 0.135), vec3(0.880, 0.230, 0.270),
                         smoothstep(0.25, 0.95, r) * 0.85);
        flesh *= 0.94 + 0.12 * fnoise(vRest * 16.0);
        // radial fibres
        flesh *= 1.0 - 0.07 * sin(r * 46.0);

        vec3 pith  = vec3(0.900, 0.930, 0.840);
        vec3 skin  = vec3(0.095, 0.270, 0.115);
        base = flesh;
        base = mix(base, pith, smoothstep(0.885, 0.935, r));
        base = mix(base, skin, smoothstep(0.952, 0.985, r));

        // seeds
        vec3 q = vRest * 7.4;
        vec3 cell = floor(q);
        vec3 fq = fract(q) - 0.5;
        float h = hash31(cell);
        if (h > 0.615 && r < 0.845) {
          vec3 jit = vec3(hash31(cell + 11.0), hash31(cell + 23.0), hash31(cell + 37.0)) - 0.5;
          float d = length((fq - jit * 0.45) * vec3(1.0, 1.45, 1.0));
          float seed = 1.0 - smoothstep(0.155, 0.215, d);
          base = mix(base, vec3(0.105, 0.055, 0.065), seed * 0.95);
        }
        sss = vec3(1.0, 0.33, 0.33);
        gloss = 40.0; rimAmt = 0.22;
      }

      vec3 Nn = normalize(vN);
      vec3 V = normalize(vV);
      if (dot(Nn, V) < 0.0) Nn = -Nn;     // keep cut faces lit from the viewer side

      float ndl  = max(dot(Nn, uKeyDir), 0.0);
      float wrap = max((dot(Nn, uKeyDir) + 0.42) / 1.42, 0.0);   // fake SSS diffusion
      float diff = mix(ndl, wrap, 0.62);
      float fill = max(dot(Nn, uFillDir), 0.0);

      vec3 col = base * (0.26 + 0.80 * diff);
      col += base * 0.22 * fill;

      // approximate transmission: light bleeding through the back of the jelly
      float back = pow(max(dot(-Nn, uKeyDir), 0.0), 2.2);
      col += sss * base * back * 0.45;

      // specular highlight
      vec3 H = normalize(uKeyDir + V);
      float spec = pow(max(dot(Nn, H), 0.0), gloss);
      col += vec3(1.0) * spec * 0.55;

      // fresnel rim — the wet, gelatinous edge
      float fres = pow(1.0 - max(dot(Nn, V), 0.0), 3.2);
      col += fres * mix(vec3(0.55, 0.95, 0.60), vec3(1.0, 0.62, 0.62), vKind) * rimAmt;

      // soft ambient occlusion toward the floor
      col *= 0.82 + 0.18 * smoothstep(uFloorY, uFloorY + 1.3, vW.y);

      gl_FragColor = vec4(pow(clamp(col, 0.0, 1.6), vec3(0.4545)), 1.0);
    }
  `;
