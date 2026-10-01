import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { COLS_STORAGE_KEY, DEFAULT_COLS, GridPrefs, GridPrefsLive, storedCols } from './prefs'

/**
 * The grid's column preference.
 *
 * The logic worth testing is not "does a number round-trip through
 * `localStorage`" — it is the three answers the old inline code gave at two
 * separate call sites, and now gives in one place: an unset preference, a
 * *corrupt* one, and a store that throws. A corrupt value and a throwing store
 * both used to be handled differently at the read and the write; they are the
 * same problem now, and both must answer the default rather than fail.
 */

/** A `Storage` over a `Map`, with a switch for the two ways a browser's
 *  `localStorage` can let you down. */
const fakeStorage = (options: { readonly throws?: boolean } = {}): Storage => {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: () => store.clear(),
    getItem: (key) => {
      if (options.throws === true) throw new Error('storage is blocked')
      return store.get(key) ?? null
    },
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key)
    },
    setItem: (key, value) => {
      if (options.throws === true) throw new Error('quota exceeded')
      store.set(key, value)
    },
  }
}

const withWindow = <A>(storage: Storage, run: () => A): A => {
  const previous = Reflect.get(globalThis, 'window')
  Reflect.set(globalThis, 'window', { localStorage: storage })
  try {
    return run()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, 'window')
    else Reflect.set(globalThis, 'window', previous)
  }
}

describe('the stored column count', () => {
  it('answers the default when nothing is stored', () => {
    expect(withWindow(fakeStorage(), storedCols)).toBe(DEFAULT_COLS)
  })

  it('answers the stored choice', () => {
    const storage = fakeStorage()
    storage.setItem(COLS_STORAGE_KEY, '6')
    expect(withWindow(storage, storedCols)).toBe(6)
  })

  it.each(['7', '0', '-1', 'wide', '', 'null'])(
    'answers the default for the stored value %j, which is not a choice',
    (stored) => {
      const storage = fakeStorage()
      storage.setItem(COLS_STORAGE_KEY, stored)
      // A value outside the list is a corrupt preference, not a preference: the
      // grid has no six-and-a-half columns, and a fallback to the nearest choice
      // would be inventing a number the operator never picked.
      expect(withWindow(storage, storedCols)).toBe(DEFAULT_COLS)
    },
  )

  it('answers the default when the store itself throws', () => {
    // Safari's private mode, a blocked third-party context: a layout preference
    // is not worth failing the first paint over.
    expect(withWindow(fakeStorage({ throws: true }), storedCols)).toBe(DEFAULT_COLS)
  })

  it('answers the default with no window at all', () => {
    // The server render and the Worker. `typeof window` is the guard, and it has
    // to be here rather than at the call site, because there is only one call
    // site now and it will not be the one that notices.
    const previous = Reflect.get(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'window')
    try {
      expect(storedCols()).toBe(DEFAULT_COLS)
    } finally {
      if (previous !== undefined) Reflect.set(globalThis, 'window', previous)
    }
  })
})

/** The real service, over a specific storage. */
const withWindowAsync = <A>(
  storage: Storage,
  program: Effect.Effect<A, never, GridPrefs>,
): Promise<A> =>
  withWindow(storage, () => Effect.runPromise(Effect.provide(program, GridPrefsLive)))

describe('the preference service', () => {
  it('round-trips a column count', async () => {
    const storage = fakeStorage()
    await withWindowAsync(
      storage,
      GridPrefs.use((prefs) => prefs.setCols(5)),
    )
    expect(storage.getItem(COLS_STORAGE_KEY)).toBe('5')
  })

  it('completes even when the store refuses the write', async () => {
    // The command layer catches this too; the point here is that the service
    // itself does not report a preference the operator cannot act on as a
    // failure.
    await expect(
      withWindowAsync(
        fakeStorage({ throws: true }),
        GridPrefs.use((p) => p.setCols(5)),
      ),
    ).resolves.toBeUndefined()
  })
})

describe('the layer over the platform storage', () => {
  it('builds without a window', async () => {
    // A layer that evaluated `window.localStorage` eagerly would take the
    // server render down with it. `layerStorage` takes the `Storage` lazily for
    // exactly this, and this is the test that says so.
    const previous = Reflect.get(globalThis, 'window')
    Reflect.deleteProperty(globalThis, 'window')
    try {
      const cols = await Effect.runPromise(
        Effect.provide(
          GridPrefs.use((prefs) => prefs.cols),
          GridPrefsLive,
        ),
      )
      expect(cols).toBe(DEFAULT_COLS)
    } finally {
      if (previous !== undefined) Reflect.set(globalThis, 'window', previous)
    }
  })
})
