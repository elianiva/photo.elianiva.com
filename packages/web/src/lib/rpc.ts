/**
 * Browser-side Effect RPC clients (ADR 0006): lazily-built `RpcClient`s over
 * fetch for the public and admin groups, each held in a long-lived
 * `ManagedRuntime` (the client needs an open Scope for its lifetime).
 *
 * Foldkit Commands consume these via `rpcPublic` / `rpcAdmin`, which
 * normalize every failure into an `RpcFailure` carrying a user-presentable
 * message.
 */

import { Data, Effect, Layer, ManagedRuntime, Scope } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'
import { RpcSerialization } from 'effect/unstable/rpc'
import { layerProtocolHttp, make as makeRpcClient } from 'effect/unstable/rpc/RpcClient'
import { PhotoAdminRpcs, PhotoPublicRpcs } from '@photo/shared'

export class RpcFailure extends Data.TaggedError('RpcFailure')<{
  readonly message: string
}> {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Best-effort readable message from any RPC failure: typed errors arrive as
 *  their decoded instances (with a `message`/`_tag` field), transport problems
 *  arrive as RpcClientError with a nested reason. */
const failureMessage = (error: unknown): string => {
  if (isRecord(error)) {
    if (typeof error['message'] === 'string' && error['message'] !== '') return error['message']
    const detail =
      typeof error['reason'] === 'object' && error['reason'] !== null
        ? failureMessage(error['reason'])
        : ''
    if (typeof error['_tag'] === 'string') {
      return `${error['_tag']}${detail === '' ? '' : `: ${detail}`}`
    }
  }
  return String(error)
}

/** A client method keyed by an RPC tag; payloads/successes are schema-typed
 *  on the server boundary and validated again on decode — the stringly-typed
 *  seam here is internal to this module. */
type ClientMethods = Record<string, (payload?: unknown) => Effect.Effect<unknown, unknown>>
const clientLayer = (url: string) =>
  layerProtocolHttp({ url }).pipe(
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson),
  )

/** Build one caller bound to a group + route. Every error channel — declared
 *  domain errors and transport errors alike — collapses into `RpcFailure`,
 *  which is all the UI ever needs to display. */
// SAFETY: `group` is always one of the shared RPC groups; the client's
// methods are keyed by its tags and reached only through the stringly-typed
// `tag` seam below, so the looseness stays internal to this module.
const rpcCaller = (group: unknown, url: string) => {
  const runtime = ManagedRuntime.make(Layer.empty)
  let clientPromise: Promise<ClientMethods> | undefined

  const getClient = (): Promise<ClientMethods> =>
    (clientPromise ??= runtime.runPromise(
      Effect.map(
        // The client (and its protocol fibers) must outlive every single
        // call — hand it an explicitly open Scope instead of relying on the
        // runtime, which builds layers without one.
        Effect.flatMap(Scope.make(), (scope) =>
          // SAFETY: methods are keyed by this exact group's tags; callers go
          // through the schema-checked wrappers below. The assertions only
          // bridge makeRpcClient's type-level protocol machinery.
          Effect.provideService(
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            makeRpcClient(group as never) as unknown as Effect.Effect<ClientMethods>,
            Scope.Scope,
            scope,
          ),
        ),
        (client) => client,
      ).pipe(Effect.provide(clientLayer(url))),
    ))

  return <A>(tag: string, payload?: unknown): Effect.Effect<A, RpcFailure> =>
    Effect.tryPromise({
      try: async () => {
        const client = await getClient()
        const method = client[tag]
        if (method === undefined) throw new Error(`Unknown RPC: ${tag}`)
        const outcome = await runtime.runPromiseExit(method(payload))
        if (outcome._tag === 'Failure') throw outcome.cause
        // SAFETY: successes are schema-decoded by the server boundary; A is
        // chosen by the typed wrappers above, so this is a trusted seam.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        return outcome.value as A
      },
      catch: (error) => new RpcFailure({ message: failureMessage(error) }),
    })
}

/** Calls on the public group (`/api/rpc`) — list/get photos, list tags. */
export const rpcPublic = rpcCaller(PhotoPublicRpcs, '/api/rpc')

/** Calls on the admin group (`/api/admin/rpc`) — update/delete photos,
 *  create/delete tags. Edge-gated + JWT-verified server-side (ADR 0007). */
export const rpcAdmin = rpcCaller(PhotoAdminRpcs, '/api/admin/rpc')
