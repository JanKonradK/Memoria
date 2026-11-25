import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Every browser Memoria runs in (WebView2, the Android WebView) reads WOFF2, so
 * the legacy WOFF copy each @fontsource face lists as a fallback only adds weight.
 */
function woff2Only() {
  return {
    name: 'memoria-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('@fontsource') || !id.endsWith('.css')) return null;
      return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, ''), map: null };
    },
  };
}

/** A game's quest catalog: loaded when its Quests tab opens. */
const QUEST_CATALOG = /src[\\/]data[\\/]quests[\\/][^\\/]+\.json$/;
/** The event archive: loaded when History or an old month opens. */
const FEED_ARCHIVE = /src[\\/]data[\\/]feed[\\/](?:archive[\\/][^\\/]+|history)\.json$/;

/**
 * Named so the service worker can tell them apart: these lazy data chunks stay
 * out of the install-time precache and are cached the first time they are read.
 */
function chunkFileName(chunk: { facadeModuleId?: string | null; moduleIds?: readonly string[] }): string {
  const ids = [chunk.facadeModuleId ?? '', ...(chunk.moduleIds ?? [])];
  if (ids.some((id) => QUEST_CATALOG.test(id))) return 'assets/catalog-[name]-[hash].js';
  if (ids.some((id) => FEED_ARCHIVE.test(id))) return 'assets/archive-[name]-[hash].js';
  return 'assets/[name]-[hash].js';
}

export default defineConfig(() => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

  return {
    // The updater compares this to the latest GitHub release.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    base: '/',
    optimizeDeps: { entries: ['index.html'] },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 350,
      rolldownOptions: {
        output: {
          chunkFileNames: chunkFileName,
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](?:react(?:-dom)?|scheduler)[\\/]/ },
              { name: 'luxon', test: /node_modules[\\/]luxon[\\/]/ },
              // The current event facts: on the first screen, but kept out of the UI chunk.
              { name: 'seed-feed', test: /src[\\/]data[\\/]feed[\\/]current\.json/ },
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
    },
    plugins: [
      woff2Only(),
      react(),
      tailwindcss(),
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
          // Workbox's default omits woff2, which is why the fonts were never
          // actually offline-capable. Precache only the subsets the UI can render:
          // vietnamese ships in dist/ but unicode-range keeps it from ever being
          // requested, so precaching it would cost weight for nothing.
          globPatterns: ['**/*.{js,css,html,ico,png,jpg,svg,webmanifest,woff2}'],
          // cyrillic-ext arrives with Black Ops One; same reasoning.
          // Quest catalogs and the event archive are only read when their tab opens:
          // they are cached then (below), not downloaded at install.
          globIgnores: [
            '**/*-{devanagari,vietnamese,cyrillic,cyrillic-ext,hebrew,thai,greek,greek-ext}-*',
            '**/assets/catalog-*',
            '**/assets/archive-*',
          ],
          runtimeCaching: [
            {
              urlPattern: /\/assets\/(?:catalog|archive)-.*\.js$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'memoria-catalogs',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
              },
            },
          ],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: { port: 5183 },
  };
});
