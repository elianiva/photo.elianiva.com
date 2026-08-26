import path from 'node:path'
import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
  },
})
