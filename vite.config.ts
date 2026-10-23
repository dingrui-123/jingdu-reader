import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icons/*.png'],
    manifest: {
      name: '静读 · 私人书房', short_name: '静读', lang: 'zh-CN',
      description: '属于自己的安静阅读时光', start_url: './', scope: './',
      display: 'standalone', background_color: '#f5f3ee', theme_color: '#f5f3ee',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
      navigateFallback: 'index.html', cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024
    },
    devOptions: { enabled: false }
  })],
  worker: { format: 'es' }
});
