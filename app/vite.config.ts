import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Dev-server twin of the desktop launcher's /hoyolab-proxy (CORS relay). */
function hoyolabDevProxy(): Plugin {
  const allowed = (url: string) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && ['.hoyolab.com', '.hoyoverse.com'].some((s) => u.hostname.endsWith(s));
    } catch {
      return false;
    }
  };
  return {
    name: 'hoyolab-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/hoyolab-proxy', (rawReq, rawRes) => {
        // Structural types — the app package deliberately has no node typings.
        const req = rawReq as unknown as {
          method?: string;
          on(ev: 'data' | 'end', fn: (chunk?: unknown) => void): void;
        };
        const res = rawRes as unknown as {
          writeHead(status: number, headers: Record<string, string>): void;
          end(body: string): void;
        };
        let body = '';
        req.on('data', (c) => (body += String(c)));
        req.on('end', async () => {
          const respond = (status: number, payload: string) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(payload);
          };
          try {
            const { url, headers } = JSON.parse(body || '{}') as { url?: string; headers?: Record<string, string> };
            if (req.method !== 'POST' || !url || !allowed(url)) return respond(400, '{"error":"url not allowed"}');
            const upstream = await fetch(url, { headers });
            respond(200, await upstream.text());
          } catch (e) {
            respond(502, JSON.stringify({ error: String(e instanceof Error ? e.message : e) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    hoyolabDevProxy(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
      manifest: {
        name: 'TechnoGG — Gacha Tracker',
        short_name: 'TechnoGG',
        description: 'Energy, dailies and event tracker for all your gacha games.',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port: 5183 },
});
