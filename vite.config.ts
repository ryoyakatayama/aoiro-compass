import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    {
      name: 'deployment-policy',
      transformIndexHtml() {
        return process.env.VITE_PRIVATE_HOST === '1'
          ? [
              {
                tag: 'link',
                attrs: { rel: 'manifest', href: '/manifest.webmanifest' },
                injectTo: 'head',
              },
            ]
          : [];
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'deployment-policy.json',
          source: JSON.stringify({
            authentication: process.env.VITE_PRIVATE_HOST === '1' ? 'server' : 'none',
            offline: process.env.VITE_PRIVATE_HOST !== '1',
          }),
        });
        if (process.env.VITE_PRIVATE_HOST === '1')
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.webmanifest',
            source: JSON.stringify({
              name: '青色コンパス',
              short_name: '青色コンパス',
              start_url: '/',
              display: 'standalone',
              lang: 'ja',
              theme_color: '#163f48',
              background_color: '#f5f6f3',
              icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              ],
            }),
          });
      },
    },
    VitePWA({
      disable: process.env.VITE_PRIVATE_HOST === '1',
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: '青色コンパス',
        short_name: '青色コンパス',
        description: '個人事業の記帳・分析・税務相談の準備',
        theme_color: '#163f48',
        background_color: '#f5f6f3',
        display: 'standalone',
        lang: 'ja',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        maximumFileSizeToCacheInBytes: 5000000,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    outDir: process.env.VITE_PRIVATE_HOST === '1' ? 'dist-private' : 'dist',
  },
});
