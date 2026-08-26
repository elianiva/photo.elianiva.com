import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  resolve: {
    tsconfigPaths: true,
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
