import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * El entregable es UN archivo que se abre con doble clic.
 *
 * Chrome trata las páginas file:// como origen opaco y bloquea los `import`
 * relativos entre archivos, así que servir los módulos de src/ tal cual rompería
 * ese requisito. Por eso todo se vuelve a empaquetar en un único dist/index.html.
 *
 * three se bundlea desde npm (el archivo queda realmente autocontenido y
 * desaparece el modo de falla "CDN caído -> pantalla en blanco"). MediaPipe
 * sigue por CDN con import() dinámico: su WASM y su modelo de 7.8 MB se bajan en
 * runtime igual, así que inlinear el wrapper no aportaría nada.
 */
export default defineConfig({
  root: 'src',
  publicDir: false,
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    chunkSizeWarningLimit: 2000,
    // todo queda inline en un solo script: el polyfill de modulepreload no tiene
    // nada que precargar y desde file:// dispara un fetch del propio documento
    modulePreload: false,
  },
});
