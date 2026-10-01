/**
 * The Admin's persisted preferences.
 *
 * There is exactly one of them — the grid's column count — and it used to be two
 * functions reaching for `window.localStorage` at their call sites. That put
 * three things in the view layer that are not the view's business: the storage
 * key, the SSR guard (`typeof window === 'undefined'`), and what to do about a
 * stored value that is not one of the choices. A storage that throws — Safari's
 * private mode, a full quota, a blocked third-party context — was also a
 * different failure at each of the two sites.
 *
 * So the storage is a `KeyValueStore` behind a Layer, the key is a constant
 * here, the guard is in the Layer, and a value that is not a choice is a
 * *decoding failure* rather than a `find(...) ?? 4` at the point of use.
 *
 * One asymmetry, and it is Foldkit's: `init` is synchronous by contract — the
 * runtime calls it to build the first model and hands it nowhere to put a
 * promise — so the *read* at startup is a plain function and the *write* is a
 * command over the service. Both go through {@link decodeStored} below, so the
 * two paths cannot disagree about what a valid column count is.
 */

import { Context, Effect, Layer, Option, Schema as S } from 'effect'
import * as KeyValueStore from 'effect/unstable/persistence/KeyValueStore'

export const COLS_STORAGE_KEY = 'photo-admin:library:cols'

/** The column counts the grid offers. The schema is the list, so a stored value
 *  outside it is a decoding failure instead of a silent fallback. */
const GridCols = S.Literals([2, 3, 4, 5, 6])
export type GridColsType = S.Schema.Type<typeof GridCols>

/** What the grid shows when nothing is stored, or when what is stored is not a
 *  choice. Stated once, because "four columns" appears in the view, the command
 *  and this module. */
export const DEFAULT_COLS: GridColsType = 4

/** The stored column count, or the default. Total: a storage that throws, or a
 *  stored value that is not one of the choices, both answer the default.
 *
 *  Persisting is total in the same way, because failing to remember a layout
 *  preference is not something the operator can act on. */
export interface GridPrefsShape {
  readonly cols: Effect.Effect<GridColsType>
  readonly setCols: (cols: GridColsType) => Effect.Effect<void>
}

export class GridPrefs extends Context.Service<GridPrefs, GridPrefsShape>()('photo/GridPrefs') {}

/** Over the platform's `Storage`, read through a `KeyValueStore`.
 *
 * `layerStorage` takes the `Storage` lazily, which is what makes the SSR case
 * work: the Worker and the server render never have a `window`, and nothing is
 * evaluated until the first read. */
export const GridPrefsLive: Layer.Layer<GridPrefs> = Layer.effect(
  GridPrefs,
  Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore
    return GridPrefs.of({
      cols: readCols(store),
      setCols: (cols) => writeCols(store, cols),
    })
  }),
).pipe(
  Layer.provide(
    KeyValueStore.layerStorage(() => {
      if (typeof window === 'undefined') {
        // Nothing to read from or write to. A no-op store rather than a throw,
        // because a preference that cannot be remembered is still a preference
        // the operator chose — and a server render must not fail over it.
        return NO_STORAGE
      }
      return window.localStorage
    }),
  ),
)

/** A `Storage` that remembers nothing. Built by hand rather than asserted, so
 *  the shape the driver reads is stated once and stays true if it grows. */
const NO_STORAGE: Storage = {
  get length() {
    return 0
  },
  clear: () => undefined,
  getItem: () => null,
  key: () => null,
  removeItem: () => undefined,
  setItem: () => undefined,
}

/**
 * What `localStorage` holds, decoded: a string, which is the only thing a
 * `Storage` can hold, into one of the column counts.
 *
 * The parse and the membership check are two steps because they answer two
 * different questions. `'wide'` is not a number; `7` is a number and not a
 * choice. Collapsing them would mean guessing — rounding `7` to a choice, or
 * reporting a parse failure as a corrupt preference — and both would be a
 * preference the operator never picked.
 */
const decodeStored = (raw: string | null | undefined): Option.Option<GridColsType> =>
  Option.flatMap(S.decodeUnknownOption(S.NumberFromString)(raw), (n) =>
    S.decodeUnknownOption(GridCols)(n),
  )

/** The stored column count, or the default. Synchronous because `init` is.
 *
 *  A `localStorage` that throws — Safari's private mode, a blocked context — is
 *  caught here rather than allowed to take the first paint with it, which is the
 *  same reason the service's read is total. */
export const storedCols = (): GridColsType => {
  if (typeof window === 'undefined') return DEFAULT_COLS
  let raw: string | null
  try {
    raw = window.localStorage.getItem(COLS_STORAGE_KEY)
  } catch {
    return DEFAULT_COLS
  }
  return Option.getOrElse(decodeStored(raw), () => DEFAULT_COLS)
}

/** The stored column count, or the default. */
const readCols = (store: KeyValueStore.KeyValueStore): Effect.Effect<GridColsType> =>
  store.get(COLS_STORAGE_KEY).pipe(
    // A `KeyValueStoreError` — a blocked context, a full quota — is a
    // preference that cannot be remembered, not a failure the operator can
    // act on. The default is the answer.
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.flatMap((raw) => Effect.succeed(decodeStored(raw))),
    Effect.map((cols) => Option.getOrElse(cols, () => DEFAULT_COLS)),
  )

/** Persist the column count. */
const writeCols = (store: KeyValueStore.KeyValueStore, cols: GridColsType): Effect.Effect<void> =>
  store.set(COLS_STORAGE_KEY, String(cols)).pipe(Effect.catch(() => Effect.void))
