/**
 * The Settings page's state machine: what the row said, what the draft says,
 * and which of them the header is reporting. Every step goes through the real
 * `init` / `update`.
 *
 * The page's own markup — the four sections, the controls, the watermark
 * contract's wording — is a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`). What is asserted here is the round trip
 * behind it: the stamp, the payload a save sends, and the CSV the index read
 * builds.
 */

import { DateTime, Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { STORAGE_CAP_BYTES, TagId } from '@photo/shared'
import type { Settings, Tag } from '@photo/shared'

import { Message } from './model'
import type { Model } from './model'
import { toSettingsDraft } from './settings-draft'
import { csvIndex } from './storage-index'
import { settingsStamp } from './views/settings'
import { init, update } from './update'

const ORIGIN = 'https://photo.elianiva.com'
const OWNER = 'owner@photo.test'
const TEAM = 'https://team.elianivaaccess.test'

/** The row's own stamp, and the instant the header reads it at. Fixed, so the
 *  stamp the page prints is asserted rather than whatever the wall clock says:
 *  `SAVED 2 MINUTES AGO` is the contract, and it only holds for a known
 *  instant. */
const SAVED_AT = '2026-02-14T11:58:00.000Z'
const NOW = DateTime.makeUnsafe('2026-02-14T12:00:00.000Z')

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const tag = (slug: string, label: string): Tag => ({
  id: TagId.make(slug),
  slug,
  label,
  caption: null,
})

const TAGS: ReadonlyArray<Tag> = [tag('kyoto', 'Kyoto')]

/** 412 Photos and 7.9 GB against the one cap the sidebar's meter is measured
 *  against — the same `GetStorageUsage` payload, so the block and the meter
 *  cannot report different numbers. */
const STORAGE = { photos: 412, bytes: 7_900_000_000, capBytes: STORAGE_CAP_BYTES }

const ROW: Settings = {
  updatedAt: SAVED_AT,
  defaultPreviewLongEdge: 1200,
  defaultPreviewFormat: 'avif',
  defaultPreviewQuality: 82,
  defaultFullQuality: 92,
  watermarkEnabled: false,
  watermarkColour: 'white',
  watermarkPosition: 'bottom-right',
  defaultKeepExif: true,
  defaultRemoveGps: true,
  retainForever: true,
}

const listed = Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 })

/** A cold load of `/admin/settings` with the shell answered and the singleton
 *  in hand. The stamp's clock is the one the tests mean, so the header is
 *  asserted on a fixed reading rather than on the wall clock. */
const loaded = (): Model =>
  [
    Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    Message.SucceededGetStorage(STORAGE),
    Message.SucceededFetchTags({ tags: [...TAGS] }),
    listed,
    Message.SucceededGetSettings({ settings: ROW }),
  ].reduce((model, message) => update(model, message).model, init(at('/admin/settings')).model)

// ---------------------------------------------------------------------------

describe('the header stamp', () => {
  it('reports when the row was saved', () => {
    // The only one of the three that needs a clock: the page reads the real
    // one, so the elapsed-time wording is asserted through the function that
    // takes the instant, rather than by freezing time for a whole page.
    expect(settingsStamp(loaded(), NOW)).toBe('SAVED 2 MINUTES AGO')
  })

  it('goes stale on an unsaved edit, and says so rather than keeping the old claim', () => {
    const edited = update(
      loaded(),
      Message.SetSettingsNumber({ field: 'defaultFullQuality', value: 60 }),
    ).model
    expect(settingsStamp(edited, NOW)).toBe('UNSAVED CHANGES')
  })

  it('says a row that has never been saved has not been saved', () => {
    const never = update(
      loaded(),
      Message.SucceededGetSettings({ settings: { ...ROW, updatedAt: null } }),
    ).model
    expect(settingsStamp(never, NOW)).toBe('NOT SAVED YET')
  })
})

describe('save and discard', () => {
  it('a save sends the draft, the whole row, and answers from the stored row', () => {
    // The payload is the draft as the form holds it: every column the row has
    // rides along, so a save of one field cannot reset another, and the answer
    // is the stored row rather than the request that produced it.
    const typed = update(
      loaded(),
      Message.SetSettingsNumber({ field: 'defaultFullQuality', value: 60 }),
    ).model
    const saving = update(typed, Message.SaveSettings({}))

    expect(saving.commands?.map((command) => command.name)).toEqual(['SaveSettings'])
    // The payload is the draft, not the row: `updatedAt` is the server's to
    // stamp and is not sent back. Everything else rides along, with the typed
    // value in the one field the operator changed. The match is exact, so the
    // absence of `updatedAt` is asserted by this line rather than beside it.
    expect(saving.commands?.[0]?.args).toEqual({
      input: { ...toSettingsDraft(ROW), defaultFullQuality: 60 },
    })

    const settled = update(
      saving.model,
      Message.SavedSettings({ settings: { ...ROW, defaultFullQuality: 60 } }),
    ).model
    expect(settled.settingsDraft.defaultFullQuality).toBe(60)
    // The stored row is the truth the draft is compared against, so the answer
    // leaves nothing unsaved even when the service changed the value it was sent.
    expect(settingsStamp(settled, NOW)).toBe('SAVED 2 MINUTES AGO')
  })

  it('a re-read landing mid-edit does not throw the edit away', () => {
    // The row can move under the draft — another tab, another operator, a
    // navigation that re-fetches. The draft keeps what was typed and the next
    // save still sends it, so the edit wins and the read after the save is
    // what confirms it.
    const edited = update(
      loaded(),
      Message.SetSettingsNumber({ field: 'defaultFullQuality', value: 60 }),
    ).model
    const reread = update(
      edited,
      Message.SucceededGetSettings({ settings: { ...ROW, defaultFullQuality: 70 } }),
    ).model

    expect(reread.settingsDraft.defaultFullQuality).toBe(60)
    expect(update(reread, Message.SaveSettings({})).commands?.[0]?.args).toMatchObject({
      input: { defaultFullQuality: 60 },
    })
    expect(settingsStamp(reread, NOW)).toBe('UNSAVED CHANGES')
  })

  it('a re-read with no edit in hand does reseed the draft', () => {
    // The other half of the rule above: keeping a draft that matches the row
    // would mean a corrected row could never reach the form.
    const reread = update(
      loaded(),
      Message.SucceededGetSettings({ settings: { ...ROW, defaultFullQuality: 70 } }),
    ).model

    expect(reread.settingsDraft.defaultFullQuality).toBe(70)
    // The draft now matches the row it was seeded from, so nothing is unsaved:
    // the correction reached the form instead of being held off it.
    expect(settingsStamp(reread, NOW)).toBe('SAVED 2 MINUTES AGO')
  })

  it('a save with nothing to save dispatches nothing', () => {
    // A save that changes no column would still stamp a new `updatedAt`, so the
    // header would claim a write the operator never made.
    expect(update(loaded(), Message.SaveSettings({})).commands ?? []).toEqual([])
  })

  it('a discard puts the row back and leaves nothing unsaved', () => {
    const edited = [
      Message.SetSettingsNumber({ field: 'defaultFullQuality', value: 60 }),
      Message.SetPreviewFormat({ value: 'webp' }),
    ].reduce((model, message) => update(model, message).model, loaded())

    expect(settingsStamp(edited, NOW)).toBe('UNSAVED CHANGES')
    const discarded = update(edited, Message.DiscardSettings({})).model
    expect(discarded.settingsDraft).toEqual(toSettingsDraft(ROW))
    expect(settingsStamp(discarded, NOW)).toBe('SAVED 2 MINUTES AGO')
  })
})

describe('the CSV index', () => {
  it('is a real download: asking for it dispatches the index read', () => {
    // The rows come from the API and the document is built and downloaded in
    // the browser, so the button's whole job is to issue `ListPhotoIndex`.
    const exporting = update(loaded(), Message.ExportCsvIndex({}))

    expect(exporting.model.settingsIndexing).toBe(true)
    expect(exporting.commands?.map((command) => command.name)).toEqual(['ExportCsvIndex'])

    // A second press while one is in flight dispatches nothing.
    expect(update(exporting.model, Message.ExportCsvIndex({})).commands ?? []).toEqual([])
  })

  it('quotes a cell the way a spreadsheet needs, and leaves a plain one alone', () => {
    const document = csvIndex([
      {
        number: 24,
        title: 'Ferries, rain, and the long light',
        slug: 'ferries-istiklal',
        ratio: '3:2',
        takenAt: '2024-11-02',
        place: 'Karaköy, Istanbul',
        tags: ['Istanbul', 'film'],
        bytes: 4_100_000,
      },
      {
        number: null,
        title: 'He said "wait"',
        slug: 'he-said-wait',
        ratio: null,
        takenAt: null,
        place: null,
        tags: [],
        bytes: null,
      },
    ])
    const [header, first, second] = document.split('\n')

    expect(header).toBe('number,title,slug,ratio,taken_at,place,tags,bytes')
    // The comma in the title and the comma in the place each force a quote. The
    // tag cell has a middot and no comma, so it needs none.
    expect(first).toBe(
      '24,"Ferries, rain, and the long light",ferries-istiklal,3:2,2024-11-02,"Karaköy, Istanbul",Istanbul · film,4100000',
    )
    // An embedded quote doubles, a null is an empty cell, not the word "null".
    expect(second).toBe(',"He said ""wait""",he-said-wait,,,,,')
  })
})
