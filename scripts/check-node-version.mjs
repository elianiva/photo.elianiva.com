#!/usr/bin/env node
/* oxlint-disable no-console -- a CLI check; its result is the output */
/**
 * Guard the Node version contract.
 *
 * `.node-version` is the one place the version the repo runs lives: both
 * workflows read it through `actions/setup-node`'s `node-version-file`, and
 * `package.json`'s `engines.node` is the floor the repo promises. Three facts
 * in three files is exactly the drift this repo already hit once (#44), so
 * this script fails when they disagree.
 *
 * The floor cannot be *derived* from the pin — a floor is a policy, not the
 * version we happen to build on. What can be checked is:
 *   1. the pin is a real version and satisfies the declared floor;
 *   2. the floor is not below the minimum the code actually needs;
 *   3. no workflow hardcodes a version instead of reading `.node-version`.
 *
 * The minimum the code needs is `node:sqlite`, which the D1 fake in
 * `@photo/api` loads and which is only stable from Node 24. See
 * `docs/adr/0005-test-fakes-on-node-sqlite.md`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

/** `node:sqlite` is stable from Node 24; see ADR 0005. */
const MINIMUM_SUPPORTED_MAJOR = 24

const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']
const ENGINE_RANGE = /^>=(\d+)(?:\.\d+){0,2}$/

const problems = []

const pinned = read('.node-version').trim().replace(/^v/, '')
const pinnedMajor = Number(pinned.split('.')[0])
if (!Number.isInteger(pinnedMajor)) {
  problems.push(`.node-version is not a version: ${JSON.stringify(pinned)}`)
}

const { engines = {} } = JSON.parse(read('package.json'))
const match = ENGINE_RANGE.exec(engines.node ?? '')
if (!match) {
  problems.push(
    `package.json engines.node must be a ">=N" range, got ${JSON.stringify(engines.node)}`,
  )
} else {
  const floor = Number(match[1])
  if (floor < MINIMUM_SUPPORTED_MAJOR) {
    problems.push(
      `package.json engines.node (>=${floor}) is below the minimum the code needs (>=${MINIMUM_SUPPORTED_MAJOR}, node:sqlite)`,
    )
  }
  if (pinnedMajor < floor) {
    problems.push(
      `.node-version (${pinned}) does not satisfy engines.node (${engines.node}); the repo would run on an unsupported Node`,
    )
  }
}

for (const workflow of WORKFLOWS) {
  const text = read(workflow)
  const hardcoded = /^\s*node-version:\s*[0-9]/m.test(text)
  if (hardcoded) {
    problems.push(`${workflow} hardcodes node-version; use node-version-file: .node-version`)
  }
  if (!text.includes('node-version-file: .node-version')) {
    problems.push(`${workflow} does not read .node-version via node-version-file`)
  }
}

if (problems.length > 0) {
  console.error('Node version contract is broken:')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`Node version contract holds: .node-version ${pinned}, engines.node ${engines.node}`)
