import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { singleFile } from './scripts/vite-single-file.ts';

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
    // Generated single-file exports contain bundled imports, not app entrypoints.
    optimizeDeps: { entries: ['index.html'] },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: single ? 4000 : 350,
      rolldownOptions: {
        // The single-file build inlines every dynamic import (see
        // scripts/vite-single-file.ts), so its output has no manual chunk groups.
        output: single
          ? {}
          : {
              codeSplitting: {
                groups: [
                  { name: 'react', test: /node_modules[\\/](?:react(?:-dom)?|scheduler)[\\/]/ },
                  { name: 'luxon', test: /node_modules[\\/]luxon[\\/]/ },
                ],
                // Keep Motion's dynamically imported feature set separate from
                // the initial page; do not collect all Motion modules in a group.
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
              // Keep the current page and its drafts until Update now is selected.
              registerType: 'prompt',
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
                globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,webmanifest,woff2}'],
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
