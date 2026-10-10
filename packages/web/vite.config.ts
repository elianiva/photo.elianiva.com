import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'

/**
 * The id one deployment renders and hydrates under.
 *
 * `Runtime.hydrate` compares the id the Worker stamped on the page with the id
 * this client carries and refuses the page when they differ, and
 * `renderToString` refuses a hydratable render that has none — so the client
 * and the Worker of one deployment must answer with the same value, and a
 * deployed build must have one at all. `FOLDKIT_BUILD_ID` is the deployment's
 * own answer when CI sets one; otherwise a fresh id is minted once and written
 * back into the environment, because Vite reads this config once per
 * environment and a value computed per read would hand the two artifacts two
 * different ids.
 */
const deploymentBuildId = (): string => {
  const fromEnvironment = process.env['FOLDKIT_BUILD_ID']
  if (fromEnvironment !== undefined && fromEnvironment !== '') return fromEnvironment
  const minted = randomUUID()
  process.env['FOLDKIT_BUILD_ID'] = minted
  return minted
}

export default defineConfig(({ command }) => ({
  // App mode: `vite build` builds every environment this config declares, not
  // just `client`, which is what makes `pnpm build` a gate on the deployed
  // Worker (see `environments.ssr` below).
  builder: {},
  // No `ssr.serverEntry`: the Cloudflare Vite plugin backs the `ssr`
  // environment with workerd, so that environment is not runnable and
  // `@foldkit/vite-plugin` stands its own dev rendering down anyway. The
  // Worker is the page host in development and in production, and it renders
  // the Front itself (ADR 0004).
  //
  // A dev server runs one live source session rather than a set of deployable
  // artifacts, so there is no deployment identity to derive and the plugin's
  // own `development` id is the honest one there.
  plugins: [tailwindcss(), ...foldkit(command === 'build' ? { buildId: deploymentBuildId() } : {})],
  resolve: {
    tsconfigPaths: true,
    alias: {
      '@photo/shared': resolve(import.meta.dirname, '../shared/src/index.ts'),
      '@photo/api': resolve(import.meta.dirname, '../api/src/index.ts'),
    },
  },
  optimizeDeps: {
    entries: ['src/entry.ts'],
    // The codecs resolve their .wasm with `new URL(..., import.meta.url)`, which
    // the dependency pre-bundler cannot rewrite.
    exclude: ['@jsquash/jpeg', '@jsquash/png', '@jsquash/resize', '@jsquash/webp'],
  },
  worker: { format: 'es' },
  // Dev only: the browser reaches the API through the site's own origin, which
  // the Vite dev server forwards to the API Worker's fixed port. A browser that
  // is not on this machine (a tunnelled or portalled dev server) cannot reach
  // `localhost:13371` itself, so the Admin's reads failed and showed "Session
  // expired". It also makes dev same-origin like production.
  server: { proxy: { '/api': 'http://localhost:13371' } },
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
}))
