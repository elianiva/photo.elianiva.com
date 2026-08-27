import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
