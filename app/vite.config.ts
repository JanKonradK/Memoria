import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { singleFile } from './scripts/vite-single-file';

/**
 * `--mode singlefile` builds the shareable copy: one self-contained
 * dist-single/Memoria.html that runs off a double-click. See scripts/vite-single-file.ts.
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'singlefile';
  const alias: Record<string, string> = {};
  if (single) {
    alias['virtual:pwa-register'] = fileURLToPath(new URL('./src/pwa-register-stub.ts', import.meta.url));
  }

  return {
    // A file:// page has no site root, so nothing may be referenced from '/'.
    base: single ? './' : '/',
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: single ? 4000 : 350,
      rollupOptions: {
        // The single-file build inlines every dynamic import (see
        // scripts/vite-single-file.ts), and Rollup rejects manualChunks alongside that.
        output: single
          ? {}
          : {
              manualChunks(id) {
                if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
                if (id.includes('node_modules/luxon')) return 'luxon';
                // Motion is deliberately NOT force-chunked: main.tsx loads the
                // domAnimation feature set via a dynamic import, and pinning every
                // motion module to one manual chunk would merge that async chunk
                // back into the eager graph and undo the split.
                return undefined;
              },
            },
      },
    },
    resolve: {
      // Force a single React instance across the app and every pre-bundled dep
      // (Radix in particular) so no dep can grab a duplicate React and trip
      // "Invalid hook call" at runtime.
      dedupe: ['react', 'react-dom'],
      alias,
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(single
        ? [singleFile()]
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
              manifest: {
                name: 'Memoria — Gacha Tracker',
                short_name: 'Memoria',
                description: 'Memoria tracks energy, dailies and events across all your gacha games.',
                theme_color: '#000000',
                background_color: '#000000',
                display: 'standalone',
                start_url: '/',
                icons: [
                  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
              },
              workbox: {
                // Workbox's default omits woff2, which is why the title fonts were never
                // actually offline-capable. Precache only the subsets the UI can render:
                // devanagari/vietnamese ship in dist/ but unicode-range keeps them from
                // ever being requested, so precaching them would cost ~590 KB for nothing.
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
                // hebrew and thai arrived with Fredoka and Chakra Petch; same reasoning.
                globIgnores: ['**/*-{devanagari,vietnamese,cyrillic,cyrillic-ext,hebrew,thai,greek,greek-ext}-*'],
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],
              },
            }),
          ]),
    ],
    server: { port: 5183 },
  };
});
