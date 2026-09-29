#!/usr/bin/env node
/**
 * Builds the website Worker into the artifact `pnpm infra:deploy` ships,
 * so `pnpm build` is the same build the deploy runs.
 *
 * Why this exists (#67): `pnpm build` alone runs `vite build`, which builds
 * only the `client` environment. The Worker the deploy uploads comes from the
 * `ssr` entry environment, which Alchemy's Vite build produces — so a broken
 * Worker build was invisible to CI and turned up only in the Deploy step, 28
 * runs in a row.
 *
 * This calls Alchemy's own `viteBuild` — the exact function
 * `Cloudflare.Website.Vite` calls during `alchemy deploy` — with the options
 * from `website.config.mjs`. It is deliberately not a second, hand-rolled
 * build: same function, same options object, so the gate and the deploy cannot
 * drift.
 *
 * Alchemy publishes no build-only command, and `alchemy deploy` needs
 * Cloudflare credentials CI does not have, which is why the build is invoked
 * directly. `viteBuild` is not on alchemy's `exports` map (`alchemy/Cloudflare/*`
 * resolves to `<name>/index.js`), so it is loaded from the file Alchemy's own
 * `import` condition resolves. If a future alchemy moves it, this throws
 * instead of quietly passing.
 */
import { join } from 'node:path'
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import * as Effect from 'effect/Effect'
import { websiteWorker } from '../website.config.mjs'

const repoRoot = join(import.meta.dirname, '..')

// `alchemy` -> `<alchemy>/lib/index.js`; the worker's Vite build sits beside it.
const { viteBuild } = await import(
  new URL('Cloudflare/Workers/Sources/Vite.js', import.meta.resolve('alchemy')).href
)

if (typeof viteBuild !== 'function') {
  throw new Error(
    'alchemy no longer exports a `viteBuild` from its worker Vite source, so this gate can no longer mirror what the deploy builds',
  )
}

const fail = (message) => Effect.die(new Error(message))

const program = Effect.gen(function* () {
  const output = yield* viteBuild(
    join(repoRoot, websiteWorker.rootDir),
    // `env` reaches the bundle as `import.meta.env.VITE_*` defines; the website
    // declares none, and Alchemy's own build passes the same empty set.
    {},
    {
      main: websiteWorker.main,
      compatibilityDate: websiteWorker.compatibility.date,
      compatibilityFlags: [...websiteWorker.compatibility.flags],
      viteEnvironments: websiteWorker.viteEnvironments,
    },
    'photo-elianiva-com/photo',
  )

  if (output.clientDirectory === undefined) {
    return yield* fail('the website build emitted no client output')
  }

  // Force the server bundle. Vite's build already fails on a bad entry, but
  // reading it back is what proves the `ssr` environment — the one the deploy
  // uploads — produced a server entry chunk at all.
  const bundle = yield* output.serverBundle
  if (bundle === undefined) {
    return yield* fail(
      `the "${websiteWorker.viteEnvironments.entry}" environment emitted no server bundle for ${websiteWorker.main}`,
    )
  }

  yield* Effect.logInfo(
    `website Worker built: entry ${bundle.files[0].path}, ${bundle.files.length} module(s), assets ${output.clientDirectory}`,
  )
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
