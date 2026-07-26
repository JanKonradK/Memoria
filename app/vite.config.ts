import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@clerk')) return 'clerk';
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
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
      manifest: {
        name: 'Void — Gacha Tracker',
        short_name: 'Void',
        description: 'Void tracks energy, dailies and events across all your gacha games.',
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
        globIgnores: ['**/*-{devanagari,vietnamese}-*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port: 5183 },
});
