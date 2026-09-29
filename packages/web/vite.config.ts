import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // App mode: `vite build` builds every environment this config declares, not
  // just `client`, which is what makes `pnpm build` a gate on the deployed
  // Worker (see `environments.ssr` below).
  builder: {},
  plugins: [tailwindcss(), ...foldkit({ ssr: { serverEntry: '/src/entry.server.ts' } })],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@photo/shared': resolve(import.meta.dirname, '../shared/src/index.ts'),
      '@photo/api': resolve(import.meta.dirname, '../api/src/index.ts'),
    },
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
  environments: {
    // The Worker `pnpm infra:deploy` uploads, so this is the description both
    // builds read: `pnpm build` builds it here, and Alchemy's Cloudflare Vite
    // plugin (`Cloudflare.Website.Vite` in `alchemy.run.ts`, which passes no
    // `main`) takes the entry from this config too. `src/worker.ts` is what
    // becomes the Worker, `dist/ssr/worker.js` is what the deploy uploads.
    //
    // `ssr` is the environment Alchemy treats as the Worker entry by default.
    ssr: {
      build: {
        outDir: 'dist/ssr',
        rollupOptions: { input: 'src/worker.ts' },
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('foldkit')) return 'foldkit'
          if (id.includes('node_modules/effect')) return 'effect'
        },
      },
    },
  },
})
