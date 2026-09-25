import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import packageJson from './package.json' with { type: 'json' };

const base = process.env.VITE_BASE_PATH || '/';
export default defineConfig({
  base,
  plugins: [
    {
      name: 'tebikae-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'LICENSE',
          source: readFileSync(new URL('./LICENSE', import.meta.url), 'utf8'),
        });
        let commit = 'unknown';
        let dirty = false;
        try {
          commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
          dirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
        } catch {
          /* Building a source archive does not require Git. */
        }
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify(
            {
              appVersion: packageJson.version,
              license: packageJson.license,
              source: 'https://github.com/scarletkc/Tebikae',
              commit,
              dirty,
              protocolVersion: 1,
              databaseVersion: 1,
              builtAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        });
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'theme.js'],
      manifest: {
        name: 'Tebikae',
        short_name: 'Tebikae',
        description: 'Simple notes, powered by GitHub Issues.',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: `${base}#/notes`,
        scope: base,
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        cacheId: 'tebikae',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
