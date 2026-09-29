/**
 * Guards on the design-system contract. These are the acceptance criteria of
 * #22 expressed as checks rather than as a claim, so a later change cannot
 * quietly undo them:
 *
 *   - the generated artefacts match the catalog they were generated from
 *   - every `role-*` token the Desk names is one the generator emits
 *   - the Desk names no colour literal
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = join(packageRoot, 'src')

/** The Desk: the public front page and the admin surface. `src/lib` and
 *  `src/api-worker.ts` are outside the design language on purpose. */
const DESIGN_DIRS = ['admin', 'components/ui', 'home']

const readdirRecursive = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return readdirRecursive(path)
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })

const deskFiles = DESIGN_DIRS.flatMap((dir) => readdirRecursive(join(sourceDir, dir)))
const deskSource = deskFiles.map((file) => ({
  file: file.slice(packageRoot.length + 1),
  text: readFileSync(file, 'utf8'),
}))

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

describe('role tokens', () => {
  const tokensCss = readFileSync(join(sourceDir, 'tokens.css'), 'utf8')

  /** `--role-*` custom properties the generator emits, Tailwind-bridged as
   *  `--color-role-*` in the same file. */
  const emitted = new Set(
    [...tokensCss.matchAll(/^\s*--role-([\w-]+):/gm)].map((match) => match[1]),
  )

  it('emits every role token the Desk names', () => {
    const named = new Set<string>()
    for (const { text } of deskSource) {
      // Any Tailwind utility that resolves against `--color-role-*`, whichever
      // property it paints: `bg-role-surface`, `border-role-hairline`,
      // `ring-role-focus/50`, `from-role-shadow/60`.
      for (const match of text.matchAll(/\b[a-z-]+-role-([a-z0-9-]+)/g)) {
        named.add(match[1]!)
      }
    }
    expect(named.size).toBeGreaterThan(0)
    const missing = [...named].filter((name) => !emitted.has(name)).sort()
    expect(missing).toEqual([])
  })
})

describe('colour literals', () => {
  it('appear nowhere in the Desk', () => {
    const offenders = deskSource
      .filter(({ text }) => /#[0-9a-fA-F]{3,8}\b/.test(text))
      .map(({ file }) => file)
      .sort()
    expect(offenders).toEqual([])
  })
})
