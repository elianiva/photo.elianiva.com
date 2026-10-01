import type { R2BucketLike } from '@photo/api'
import { describe, expect, it } from 'vitest'
import type { WebsiteEnv } from '../../../alchemy.run'

/**
 * The Worker's `PHOTOS` binding type and the `R2BucketLike` the services take are
 * two declarations that have to agree, and they live in different files: the env
 * shape is at the workspace root, which NodeNext resolves with no path mapping
 * for the workspace packages, so it cannot import the contract.
 *
 * They have drifted before. The env shape listed only the members the code
 * called, so it was missing `head` and `list` — and the wiring then handed the
 * binding over with an `as never`, which made the mismatch disappear instead of
 * surfacing it. The two functions below are the check: each one only compiles
 * while the assignment holds, so drift is a type error in `pnpm typecheck`.
 */
const envBindingIsR2BucketLike = (photos: WebsiteEnv['PHOTOS']): R2BucketLike => photos
const r2BucketLikeIsEnvBinding = (photos: R2BucketLike): WebsiteEnv['PHOTOS'] => photos

/** A bucket carrying every member, so the runtime half checks the same
 *  completeness the type half does. */
const aBucket = {
  get: async () => null,
  head: async () => null,
  list: async () => ({ objects: [], truncated: false }),
  put: async () => undefined,
  delete: async () => undefined,
}

describe('the Worker binding and the R2 contract', () => {
  it('agree in both directions', () => {
    const asContract: R2BucketLike = envBindingIsR2BucketLike(aBucket)
    const asEnvBinding: WebsiteEnv['PHOTOS'] = r2BucketLikeIsEnvBinding(aBucket)

    expect(Object.keys(asContract).sort()).toEqual(Object.keys(asEnvBinding).sort())
  })

  it('name every member the bucket has', () => {
    expect(Object.keys(aBucket).sort()).toEqual(['delete', 'get', 'head', 'list', 'put'])
  })
})
