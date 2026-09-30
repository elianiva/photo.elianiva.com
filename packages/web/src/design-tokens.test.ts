/**
 * Guards on the design-system contract: the generated artefacts are checked
 * against the catalog they were generated from by the generator's own `--check`
 * mode, which fails the process rather than returning when a token has drifted.
 */

import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('the generated design artefacts', () => {
  it('match the vendored catalog', () => {
    // `--check` fails the process rather than returning, which is what we want
    // inside a test run.
    expect(() =>
      execFileSync(
        process.execPath,
        [join(packageRoot, 'scripts', 'generate-design-tokens.mjs'), '--check'],
        {
          cwd: packageRoot,
          stdio: 'pipe',
        },
      ),
    ).not.toThrow()
  })
})
