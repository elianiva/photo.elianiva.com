/**
 * The website Worker's build contract — the single description of how
 * `packages/web` becomes the deployed `photo.elianiva.com` Worker.
 *
 * Two callers read it, and they must agree:
 *
 * - `alchemy.run.ts` hands it to `Cloudflare.Website.Vite`, which builds the
 *   Worker during `pnpm infra:deploy`.
 * - `scripts/build-website.mjs` runs Alchemy's own `viteBuild` with the same
 *   options during `pnpm build`, so the CI gate builds the artifact the deploy
 *   actually ships rather than only the client half of it.
 *
 * A value that lives in only one of the two is how this gap reopened once
 * already (#67): a wrong `viteEnvironments.entry` is invisible to a plain
 * `vite build` and fatal at deploy time.
 */
export const websiteWorker = {
  /** Vite root, relative to the repo root. */
  rootDir: 'packages/web',
  /** The Worker entry, relative to `rootDir`. */
  main: 'src/worker.ts',
  /**
   * Which Vite environment holds the Worker's server bundle. `ssr` is both
   * Alchemy's default and the environment the Foldkit plugin's server side
   * expects, so naming it leaves no second, entry-less server environment for
   * the build to fall back to `index.html` on.
   */
  viteEnvironments: { entry: 'ssr' },
  /** Worker compatibility. The build bakes the same flags into the bundle. */
  compatibility: { date: '2025-09-01', flags: ['nodejs_compat'] },
}
