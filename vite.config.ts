import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The app decides when a new build takes over, rather than the new
      // service worker claiming the page and leaving the running app on the
      // code it already loaded. See `src/updates.ts`.
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'T-Card Planner',
        short_name: 'Planner',
        description: 'A T-card board crossed with a calendar for planning your working week.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#eef1f5',
        theme_color: '#2179c8',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell is cached so the board opens without a connection; the API
        // never is, or a stale board would come back from the cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // A callback rather than a regular expression: Workbox matches those
        // against the whole URL, so an anchored `/^\/api\//` never fires.
        runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173 },
});
