/**
 * `R2BucketLike` backed by an in-memory `Map`.
 *
 * R2's read surface is small enough to be faithful rather than approximate:
 * `get` streams the stored bytes back, `head` reports size without a body, and
 * `list` walks keys lexicographically with a `prefix` filter. Byte counts and
 * storage totals are the reason `head` and `list` are on the interface at all,
 * so both report `size` and `uploaded` the way the real binding does.
 *
 * The `cursor` is the last key of the previous page, base64url-encoded. R2's own
 * cursor is opaque, so a test may not assert on its shape — only round-trip it.
 *
 * Node-only. Never exported from the package index.
 */

import { DateTime } from 'effect'
import type { R2BucketLike, R2ListOptions, R2ObjectLike, R2ObjectsLike } from '../gateway'

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
    list: async (options: R2ListOptions = {}): Promise<R2ObjectsLike> => {
      const after = options.cursor === undefined ? null : decodeCursor(options.cursor)
      const matches = [...store.keys()]
        .filter((key) => (options.prefix === undefined ? true : key.startsWith(options.prefix)))
        .filter((key) => (after === null ? true : lexicographic(key, after) > 0))
        .sort(lexicographic)
      const limit = options.limit ?? 1000
      const page = matches.slice(0, limit)
      const last = page.at(-1)
      const truncated = matches.length > page.length
      return {
        objects: page.map((key) => describe(key, store.get(key)!, null)),
        truncated,
        ...(truncated && last !== undefined ? { cursor: encodeCursor(last) } : {}),
      }
    },
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

const encodeCursor = (lastKey: string): string =>
  btoa(lastKey).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

const decodeCursor = (cursor: string): string | null => {
  const padded = cursor.replaceAll('-', '+').replaceAll('_', '/')
  try {
    return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  } catch {
    return null
  }
}
