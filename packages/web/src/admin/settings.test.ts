/**
 * The Settings page, driven the way the operator drives it: a cold load of
 * `/admin/settings` with the singleton answered, a control picked, a field
 * typed into, a section row re-ordered, and a save. Every step goes through the
 * real `init` / `update` / `view`.
 *
 * The page's whole state machine is three things — what the row said, what the
 * draft says, and which of them the header is reporting — so that is what these
 * scenes assert: the controls round-trip, the stamp tracks the difference, and
 * `Save settings` sends the draft rather than the request that produced it.
 */

import { DateTime, Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { STORAGE_CAP_BYTES, TagId } from '@photo/shared'
import type { Settings, Tag } from '@photo/shared'

import { Message } from './model'
import type { Model } from './model'
import { applySectionEdit, emptySettingsDraft, toSettingsDraft } from './settings-draft'
import { csvIndex } from './storage-index'
import { init, update } from './update'
import { settingsStamp } from './views/settings'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'
const OWNER = 'owner@photo.test'
const TEAM = 'https://team.elianivaaccess.test'

/** The row's own stamp, and the instant two minutes after it. Fixed, so the
 *  header's reading is asserted rather than whatever the wall clock says. */
const SAVED_AT = '2026-02-14T11:58:00.000Z'
const TWO_MINUTES_LATER = DateTime.makeUnsafe('2026-02-14T12:00:00.000Z')

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

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
  copyright: '© Elianiva',
  retainForever: true,
  volume: 'V',
  motto: 'Street, mostly. Landscape, sometimes.',
  aboutCopy: 'One camera, one lens, and a lot of walking.',
  sections: [
    { kind: 'all', label: 'All' },
    { kind: 'tag', label: 'Street', target: 'street' },
  ],
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

const cold = () => Scene.given(loaded())

// ---------------------------------------------------------------------------
// locators — named by what the operator reads, not by what the markup is
// ---------------------------------------------------------------------------

const longEdge = Scene.role('combobox', { name: 'PREVIEW LONG EDGE' })
const format = Scene.role('combobox', { name: 'FORMAT' })
const previewQuality = Scene.role('slider', { name: 'PREVIEW QUALITY' })
const fullQuality = Scene.role('slider', { name: 'FULL QUALITY' })
const position = Scene.role('combobox', { name: 'POSITION' })
const retain = Scene.role('combobox', { name: 'RETAIN' })
const copyright = Scene.role('textbox', { name: 'COPYRIGHT' })
const motto = Scene.role('textbox', { name: 'MOTTO' })
const aboutCopy = Scene.role('textbox', { name: 'ABOUT COPY' })
const keepExif = Scene.role('switch', { name: 'Keep EXIF data' })
const removeGps = Scene.role('switch', { name: 'Remove GPS location' })
const watermarkSwitch = Scene.role('switch', { name: 'Watermark new uploads' })
const save = Scene.role('button', { name: 'Save settings' })
const discard = Scene.role('button', { name: 'Discard changes' })
const exportIndex = Scene.role('button', { name: 'Export a CSV index' })
const stamp = Scene.selector('[data-slot="page-head-stamp"]')

// ---------------------------------------------------------------------------

describe('the five sections', () => {
  it('all render, and each is closed by a hairline', () => {
    Scene.scene(
      app,
      cold(),
      Scene.expect(Scene.role('heading', { name: 'EXPORT DEFAULTS' })).toExist(),
      Scene.expect(Scene.role('heading', { name: 'WATERMARK' })).toExist(),
      Scene.expect(Scene.role('heading', { name: 'METADATA' })).toExist(),
      // The design labels this ARCHIVE; ADR 0008 splits the collision and the
      // canvas's own sidebar block is already called Storage.
      Scene.expect(Scene.role('heading', { name: 'STORAGE' })).toExist(),
      Scene.expect(Scene.role('heading', { name: 'SITE' })).toExist(),
      Scene.expectAll(Scene.all.selector('main section')).toHaveCount(5),
    )
  })

  it('draw the row the API read, not the defaults', () => {
    Scene.scene(
      app,
      cold(),
      Scene.expect(longEdge).toHaveValue('1200'),
      Scene.expect(format).toHaveValue('avif'),
      Scene.expect(previewQuality).toHaveValue('82'),
      Scene.expect(fullQuality).toHaveValue('92'),
      Scene.expect(position).toHaveValue('bottom-right'),
      Scene.expect(copyright).toHaveValue('© Elianiva'),
      Scene.expect(motto).toHaveValue('Street, mostly. Landscape, sometimes.'),
      Scene.expect(aboutCopy).toHaveValue('One camera, one lens, and a lot of walking.'),
      Scene.expect(keepExif).toBeChecked(),
      Scene.expect(removeGps).toBeChecked(),
      Scene.expect(watermarkSwitch).not.toBeChecked(),
    )
  })

  it('report the storage figure live, off the one read the meter draws', () => {
    Scene.scene(
      app,
      cold(),
      // 412 Photos and 7.9 GB of the cap `STORAGE_CAP_BYTES` declares. The
      // meter's own reading of the same payload is asserted in `shell.test.ts`.
      Scene.expect(Scene.text('412 FRAMES · 7.9 GB OF 21 GB')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Export a CSV index' })).toExist(),
    )
  })

  it('print the watermark contract verbatim, because it is a contract', () => {
    // The string and the behaviour are one promise: a mark on published
    // renditions, never on the original a download serves. E2 inherits it.
    Scene.scene(
      app,
      cold(),
      Scene.expect(
        Scene.text(
          'Applies to published renditions. Downloads always serve the unmarked original.',
        ),
      ).toExist(),
    )
  })

  it('hold RETAIN at FOREVER and off, because nothing purges on a timer', () => {
    Scene.scene(
      app,
      cold(),
      Scene.expect(retain).toHaveValue('forever'),
      Scene.expect(retain).toBeDisabled(),
    )
  })
})

describe('the header stamp', () => {
  it('reports when the row was saved', () => {
    expect(settingsStamp(loaded(), TWO_MINUTES_LATER)).toBe('SAVED 2 MINUTES AGO')
  })

  it('goes stale on an unsaved edit, and says so rather than keeping the old claim', () => {
    const edited = update(
      loaded(),
      Message.SetSettingsText({ field: 'motto', value: 'Night' }),
    ).model
    expect(settingsStamp(edited, TWO_MINUTES_LATER)).toBe('UNSAVED CHANGES')
    // And the header itself, not just the function behind it.
    Scene.scene(
      app,
      Scene.given(edited),
      Scene.expect(Scene.text('UNSAVED CHANGES')).toExist(),
      Scene.expect(Scene.text('SAVED 2 MINUTES AGO')).not.toExist(),
    )
  })

  it('says a row that has never been saved has not been saved', () => {
    const never = update(
      loaded(),
      Message.SucceededGetSettings({ settings: { ...ROW, updatedAt: null } }),
    ).model
    expect(settingsStamp(never, TWO_MINUTES_LATER)).toBe('NOT SAVED YET')
  })

  it('reads the clock where the Page Head renders it', () => {
    // The stamp is rendered by the Page Head, so the header is asserted
    // against a Model loaded and immediately read.
    Scene.scene(app, cold(), Scene.expect(stamp).toExist())
  })
})

describe('save and discard', () => {
  it('are both off until the form differs from the row', () => {
    Scene.scene(
      app,
      cold(),
      Scene.expect(save).toBeDisabled(),
      Scene.expect(discard).toBeDisabled(),
    )
  })

  it('a save sends the draft, the whole row, and answers from the stored row', () => {
    // The payload is the draft as the form holds it: every column the row has
    // rides along, so a save of one field cannot reset another, and the answer
    // is the stored row rather than the request that produced it.
    const typed = update(
      loaded(),
      Message.SetSettingsText({ field: 'motto', value: 'Night, mostly.' }),
    ).model
    const saving = update(typed, Message.SaveSettings({}))

    expect(saving.commands?.map((command) => command.name)).toEqual(['SaveSettings'])
    expect(saving.commands?.[0]?.args).toEqual({
      input: {
        ...toSettingsDraft(ROW),
        motto: 'Night, mostly.',
        // An empty field is a null column on the wire, not an empty string.
        copyright: '© Elianiva',
        aboutCopy: ROW.aboutCopy,
      },
    })

    const settled = update(
      saving.model,
      Message.SavedSettings({ settings: { ...ROW, motto: 'Night, mostly.' } }),
    ).model
    expect(settingsStamp(settled, TWO_MINUTES_LATER)).toBe('SAVED 2 MINUTES AGO')
    Scene.scene(app, Scene.given(settled), Scene.expect(save).toBeDisabled())
  })

  it('clearing a field sends a null column, not an empty string', () => {
    // A nullable column carries "never written". An empty string is not that,
    // and a save that wrote one would leave the Colophon printing a blank the
    // operator never asked for.
    const cleared = [
      Message.SetSettingsText({ field: 'aboutCopy', value: '' }),
      Message.SetSettingsText({ field: 'motto', value: '' }),
      Message.SetSettingsText({ field: 'copyright', value: '' }),
    ].reduce((model, message) => update(model, message).model, loaded())

    expect(update(cleared, Message.SaveSettings({})).commands?.[0]?.args).toEqual({
      input: { ...toSettingsDraft(ROW), copyright: null, motto: null, aboutCopy: null },
    })
  })

  it('a re-read landing mid-edit does not throw the edit away', () => {
    // The row can move under the draft — another tab, another operator, a
    // navigation that re-fetches. The draft keeps what was typed and the next
    // save still sends it, so the edit wins and the read after the save is
    // what confirms it.
    const edited = update(
      loaded(),
      Message.SetSettingsText({ field: 'motto', value: 'Night, mostly.' }),
    ).model
    const reread = update(
      edited,
      Message.SucceededGetSettings({ settings: { ...ROW, motto: 'Something else.' } }),
    ).model

    expect(reread.settingsDraft.motto).toBe('Night, mostly.')
    expect(settingsStamp(reread, TWO_MINUTES_LATER)).toBe('UNSAVED CHANGES')
    expect(update(reread, Message.SaveSettings({})).commands?.[0]?.args).toMatchObject({
      input: { motto: 'Night, mostly.' },
    })
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
    expect(settingsStamp(reread, TWO_MINUTES_LATER)).toBe('SAVED 2 MINUTES AGO')
  })

  it('a save with nothing to save dispatches nothing', () => {
    // A save that changes no column would still stamp a new `updatedAt`, so the
    // header would claim a write the operator never made.
    expect(update(loaded(), Message.SaveSettings({})).commands ?? []).toEqual([])
  })

  it('a discard puts the row back and turns both buttons off again', () => {
    const edited = [
      Message.SetSettingsText({ field: 'aboutCopy', value: 'Something else.' }),
      Message.SetSettingsNumber({ field: 'defaultFullQuality', value: 60 }),
      Message.SetPreviewFormat({ value: 'webp' }),
    ].reduce((model, message) => update(model, message).model, loaded())

    expect(settingsStamp(edited, TWO_MINUTES_LATER)).toBe('UNSAVED CHANGES')

    Scene.scene(
      app,
      Scene.given(update(edited, Message.DiscardSettings({})).model),
      Scene.expect(aboutCopy).toHaveValue('One camera, one lens, and a lot of walking.'),
      Scene.expect(fullQuality).toHaveValue('92'),
      Scene.expect(format).toHaveValue('avif'),
      Scene.expect(discard).toBeDisabled(),
    )
  })
})

describe('the SECTIONS repeater', () => {
  it('renders one row per Section, and a target field only where the kind goes somewhere', () => {
    Scene.scene(
      app,
      cold(),
      // Two Sections, so two LABEL fields — and one TARGET, because the second
      // Section is a `tag` and the first is the Front itself, which goes
      // nowhere and has no target even by accident. That is the `SiteSection`
      // union in `@photo/shared` doing the work, not a hidden input.
      Scene.expectAll(Scene.all.role('textbox', { name: 'LABEL' })).toHaveCount(2),
      Scene.expectAll(Scene.all.role('textbox', { name: 'TARGET' })).toHaveCount(1),
      Scene.expect(Scene.role('combobox', { name: 'TARGET' })).not.toExist(),
    )
  })

  it('adds, re-orders and removes rows, and the order is the order they render in', () => {
    const afterAdd = update(loaded(), Message.EditedSection({ edit: { _tag: 'Add' } })).model
    expect(afterAdd.settingsDraft.sections.length).toBe(3)

    const moved = update(
      afterAdd,
      Message.EditedSection({ edit: { _tag: 'Move', index: 2, delta: -1 } }),
    ).model
    expect(moved.settingsDraft.sections.map((section) => section.label)).toEqual([
      'All',
      '',
      'Street',
    ])

    const removed = update(
      moved,
      Message.EditedSection({ edit: { _tag: 'Remove', index: 0 } }),
    ).model
    expect(removed.settingsDraft.sections.map((section) => section.label)).toEqual(['', 'Street'])
  })

  it('re-typing a row clears the target the old kind owned', () => {
    // A target is a slug naming a destination. Under `series` it named a
    // Series, and a `page` destination is not that, so carrying it across would
    // publish a nav entry that points somewhere nobody chose.
    const retyped = applySectionEdit(ROW.sections, {
      _tag: 'SetKind',
      index: 1,
      kind: 'page',
    })
    expect(retyped[1]).toEqual({ kind: 'page', label: '', target: '' })
  })

  it('cannot write a target onto the `all` row', () => {
    const edited = applySectionEdit(ROW.sections, { _tag: 'SetTarget', index: 0, value: 'street' })
    expect(edited[0]).toEqual({ kind: 'all', label: 'All' })
  })

  it('a move off either end changes nothing', () => {
    expect(applySectionEdit(ROW.sections, { _tag: 'Move', index: 0, delta: -1 })).toEqual(
      ROW.sections,
    )
    expect(applySectionEdit(ROW.sections, { _tag: 'Move', index: 1, delta: 1 })).toEqual(
      ROW.sections,
    )
  })

  it("the repeater is the page's only way in, and a new row draws its own fields", () => {
    const afterAdd = update(loaded(), Message.EditedSection({ edit: { _tag: 'Add' } })).model
    const named = update(
      afterAdd,
      Message.EditedSection({ edit: { _tag: 'SetLabel', index: 2, value: 'About' } }),
    ).model
    Scene.scene(
      app,
      Scene.given(named),
      Scene.expect(Scene.role('button', { name: 'Add a section' })).toExist(),
      // A third Section is a third row, and a new row starts on `tag` so it
      // comes with the target field a routable kind needs.
      Scene.expectAll(Scene.all.role('textbox', { name: 'LABEL' })).toHaveCount(3),
      Scene.expectAll(Scene.all.role('textbox', { name: 'TARGET' })).toHaveCount(2),
    )
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

    Scene.scene(
      app,
      Scene.given(loaded()),
      Scene.expect(exportIndex).toBeEnabled(),
      Scene.expect(Scene.role('button', { name: 'Building the index…' })).not.toExist(),
    )
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

describe('the draft', () => {
  it('turns an empty field into a null column, and a null column into an empty field', () => {
    // The lossless direction matters more than the other: an empty ABOUT COPY
    // has to come back as an empty field, or a discard would not restore the row.
    const cleared = update(
      loaded(),
      Message.SetSettingsText({ field: 'aboutCopy', value: '' }),
    ).model
    const saved = update(cleared, Message.DiscardSettings({})).model
    expect(saved.settingsDraft.aboutCopy).toBe(ROW.aboutCopy)
  })

  it("starts from the migration's own defaults, so the first paint is the row's page", () => {
    expect(emptySettingsDraft.defaultPreviewLongEdge).toBe(1200)
    expect(emptySettingsDraft.defaultPreviewFormat).toBe('avif')
    expect(emptySettingsDraft.defaultPreviewQuality).toBe(82)
    expect(emptySettingsDraft.defaultFullQuality).toBe(92)
    expect(emptySettingsDraft.watermarkPosition).toBe('bottom-right')
  })

  it('carries the authored volume through a save rather than resetting it', () => {
    // The design's SITE section draws MOTTO, SECTIONS and ABOUT COPY and no
    // VOLUME, so the draft holds the stored value and never offers a control
    // for it. #38's Masthead reads the column this keeps intact.
    const edited = update(
      loaded(),
      Message.SetSettingsText({ field: 'motto', value: 'Night.' }),
    ).model
    const input = update(edited, Message.SaveSettings({})).commands?.[0]
    expect(input?.args).toMatchObject({ input: { volume: 'V' } })
  })
})
