/**
 * `R2BucketLike` backed by an in-memory `Map`.
 *
 * The services write originals and delete them, and the tests read the bucket
 * back to prove the write landed: `put` and `delete` are the product's half of
 * the contract, and `get`, `head` and `list` are how a test observes it. So
 * `get` streams the stored bytes back and `head` reports the size without a
 * body, because those are the two shapes the assertions ask for.
 *
 * `list` takes no options. Nothing in the suite pages the bucket — Photo
 * listing is a D1 query, not an R2 one — so honouring `limit`, `cursor` and
 * `prefix` here would be a fidelity nothing could check.
 *
 * Node-only. Never exported from the package index.
 */

import { DateTime } from 'effect'
import type { R2BucketLike, R2ObjectLike } from '../gateway'

interface StoredObject {
  readonly bytes: Uint8Array
  readonly contentType: string | undefined
  readonly uploaded: Date
}

/** Every shape the real bucket's `put` accepts. `null` and `Blob` come from
 *  the platform's signature rather than from anything a service does, and both
 *  have to be handled here rather than narrowed away at the interface. */
const toBytes = async (
  value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string | null,
): Promise<Uint8Array> => {
  if (value === null) return new Uint8Array(0)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array(await new Response(value).arrayBuffer())
}

/** A fresh `ArrayBuffer`-backed copy — `Response` rejects a `Uint8Array` view
 *  over a shared or resizable buffer. */
const toBody = (bytes: Uint8Array): ReadableStream =>
  new Response(new Uint8Array(bytes).buffer).body ?? new ReadableStream()

export const makeR2Fake = (): R2BucketLike => {
  const store = new Map<string, StoredObject>()

  const describe = (
    key: string,
    object: StoredObject,
    body: ReadableStream | null,
  ): R2ObjectLike => ({
    key,
    size: object.bytes.byteLength,
    uploaded: object.uploaded,
    ...(object.contentType === undefined
      ? {}
      : { httpMetadata: { contentType: object.contentType } }),
    body,
  })

  const lexicographic = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0

  return {
    get: async (key) => {
      const object = store.get(key)
      return object === undefined ? null : describe(key, object, toBody(object.bytes))
    },
    head: async (key) => {
      const object = store.get(key)
      return object === undefined ? null : describe(key, object, null)
    },
    list: async () => ({
      objects: [...store.keys()]
        .sort(lexicographic)
        .map((key) => describe(key, store.get(key)!, null)),
      truncated: false,
    }),
    put: async (key, value, options) => {
      const object: StoredObject = {
        bytes: await toBytes(value),
        contentType: options?.httpMetadata?.contentType,
        // R2 hands back a native `Date`, which is what the binding contract declares.
        uploaded: DateTime.toDate(DateTime.nowUnsafe()),
      }
      store.set(key, object)
      return describe(key, object, null)
    },
    delete: async (keys) => {
      // R2 deletes in bulk; the services only ever pass one key.
      for (const key of typeof keys === 'string' ? [keys] : keys) store.delete(key)
    },
  }
}
