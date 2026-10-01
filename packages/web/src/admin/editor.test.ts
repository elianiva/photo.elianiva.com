/**
 * The Editor's state machine, driven the way the operator drives it: a cold
 * load of `/admin/photos/:id`, the Status segment, the unsaved-change rule, and
 * the two ways out of a dirty page. Every step goes through the real
 * `init` / `update`, and every response is folded through the same `update` the
 * runtime folds Command results through.
 *
 * The Stage, the Inspector's controls, the Mat's geometry and the crop frame
 * are a page, and a page is verified in the browser
 * (`.agents/skills/verify-photo`). What is asserted here is the logic behind
 * them: what is dirty, what a save sends, what the Blurhash signature covers,
 * and what the leave guard does to the URL.
 */

import { Option } from 'effect'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId } from '@photo/shared'
import type { PhotoPresentation } from '@photo/shared'

import * as Segment from '@/components/ui/segment'

import {
  EDITOR_STATUS_SEGMENT,
  MAT_FOOT_MULTIPLE,
  blurhashSignature,
  compositionSpec,
  withEditorExport,
} from './editor'
import { Message } from './model'
import type { Model } from './model'
import { defaultLibraryFilters, libraryRoute } from './route'
import { init, onUrlChange, update } from './update'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const PHOTO_ID = PhotoId.make('photo-1')
const EDITOR_PATH = `/admin/photos/${PHOTO_ID}`

/** A valid 4-component Blurhash, standing in for the one a re-encode returns. */
const HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

const photo = {
  id: PHOTO_ID,
  slug: 'jakarta-last-of-the-sun',
  title: 'Jakarta, the last of the sun on Jalan Pintu Besar',
  r2Key: 'originals/jakarta.jpg',
  width: 6000,
  height: 4000,
  status: 'published',
  number: 24,
  ratio: '3:2',
  bytes: 18_400_000,
  takenAt: '2025-08-31',
  blurhash: null,
  metadata: { location: 'Kota Tua, Jakarta' },
} as const

/** What migration 0004 stores for a Photo nobody has edited, except that the
 *  Mat is on: the design's Editor draws one, and `borderEnabled` is the field
 *  the shell's own control writes. */
const PRESENTATION: PhotoPresentation = {
  cropX: 0,
  cropY: 0,
  cropScale: 1,
  cropFlipX: false,
  level: null,
  borderEnabled: true,
  borderStyle: 'gallery',
  borderColour: 'white',
  borderWidth: 4,
  previewLongEdge: 1200,
  previewFormat: 'avif',
  previewQuality: 82,
  fullQuality: 92,
  keepExif: true,
  removeGps: true,
}

const NO_MAT = { ...PRESENTATION, borderEnabled: false }

/** The shell's three reads, answered the way the `dev` stage answers them: a
 *  proven session with no claim to print. */
const shellReads: ReadonlyArray<Message> = [
  Message.SucceededGetSession({ email: null, teamDomain: null }),
  Message.SucceededGetCounts({
    total: 412,
    trashed: 3,
    byStatus: { draft: 7, published: 402, failed: 1 },
    byTag: [],
  }),
]

const foldIn = (model: Model, messages: ReadonlyArray<Message>): Model =>
  messages.reduce((current, message) => update(current, message).model, model)

/** The Editor, cold, with the shell's reads answered and its own two still in
 *  flight. */
const loading = (pathname = EDITOR_PATH): Model => foldIn(init(at(pathname)).model, shellReads)

/** The same Editor with its two reads answered: a finished page. */
const opened = (pathname = EDITOR_PATH): Model =>
  foldIn(loading(pathname), [
    Message.SucceededFetchPhoto({ id: PHOTO_ID, photo }),
    Message.SucceededFetchPresentation({ id: PHOTO_ID, presentation: PRESENTATION }),
  ])

/** The Editor reached by navigating there from `pathname`, which is what makes
 *  `← Library` mean something. */
const reachedFrom = (pathname: string): Model =>
  update(update(opened(), onUrlChange(at(pathname))).model, onUrlChange(at(EDITOR_PATH))).model

const dispatched = (result: {
  readonly commands?: ReadonlyArray<{ readonly name: string; readonly args?: unknown }>
}): ReadonlyArray<{ name: string; args?: unknown }> =>
  (result.commands ?? []).map((command) => ({ name: command.name, args: command.args }))

describe('the Editor on a cold load', () => {
  it('is loading until its own two reads answer, and retries both together', () => {
    expect(loading().photoStatus).toBe('loading')

    // Either read failing leaves the Editor with nothing to draw — the Photo is
    // the record, the Presentation is the Mat — so a retry is both of them
    // rather than whichever one failed.
    const failed = foldIn(loading(), [Message.FailedFetchPhoto({ id: PHOTO_ID, message: 'gone' })])
    expect(failed.photoStatus).toBe('error')
    expect(
      dispatched(update(failed, Message.RetryFetchPhoto())).map((entry) => entry.name),
    ).toEqual(['FetchPhoto', 'FetchPresentation'])
  })

  it('records the route it was opened from, so `← Library` goes back there', () => {
    expect(reachedFrom('/admin/drafts').editor.returnRoute).toEqual({ _tag: 'Drafts' })
    expect(reachedFrom('/admin?status=draft').editor.returnRoute).toEqual(
      libraryRoute({ ...defaultLibraryFilters, status: 'draft' }),
    )
  })
})

describe('the unsaved-changes rule', () => {
  it('a clean Editor sends nothing to save', () => {
    // `Update` is disabled while clean, so a save with no change cannot be
    // dispatched at all. Asserted on the message rather than the button
    // because that is the invariant a later panel could break.
    const clean = update(opened(), Message.SubmitEditorUpdate())
    expect(clean.commands ?? []).toHaveLength(0)
    expect(clean.model.editor.saving).toBe(false)
  })

  it('sends the draft, and clears off the stored truth the save answered with', () => {
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false }))
    expect(dirty.model.editor.draft?.borderEnabled).toBe(false)

    const saving = update(dirty.model, Message.SubmitEditorUpdate())
    expect(saving.model.editor.saving).toBe(true)
    // A Mat is a Presentation field, so it rides the presentation call and
    // nothing else: no Ratio, no record, no Blurhash the pixels did not move.
    expect(dispatched(saving)).toEqual([
      {
        name: 'UpdateEditor',
        args: { id: PHOTO_ID, presentation: NO_MAT, savePresentation: true },
      },
    ])

    // The service answers with what it stored and the Stage keeps drawing the
    // answer, so a value it changed comes back as stored rather than as sent.
    const settled = update(
      saving.model,
      Message.UpdatedEditor({ id: PHOTO_ID, presentation: NO_MAT }),
    ).model
    expect(settled.editor.draft?.borderEnabled).toBe(false)
    expect(update(settled, Message.SubmitEditorUpdate()).commands ?? []).toHaveLength(0)
  })

  it('a Ratio-only save does not rewrite the crop', () => {
    // The Ratio is a Photo column beside the draft rather than a field in it, so
    // a save that moved only the Ratio must not send a crop write — a crop write
    // is a Rendition regeneration (#35).
    const reRatted = update(opened(), Message.SetEditorRatio({ ratio: '4:3' }))
    expect(dispatched(update(reRatted.model, Message.SubmitEditorUpdate()))).toEqual([
      {
        name: 'UpdateEditor',
        args: {
          id: PHOTO_ID,
          presentation: PRESENTATION,
          ratio: '4:3',
          savePresentation: false,
        },
      },
    ])
  })

  it('discards to the snapshot it loaded, not to the field that was touched', () => {
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false }))
    const discarded = update(dirty.model, Message.DiscardEditor({})).model
    expect(discarded.editor.draft).toEqual(PRESENTATION)
    expect(update(discarded, Message.SubmitEditorUpdate()).commands ?? []).toHaveLength(0)
  })
})

describe('the DETAILS record', () => {
  it('writes the Status through SetPhotoStatus, then re-reads the counts', () => {
    const picked = update(
      opened(),
      Message.GotSegmentMessage({
        groupId: EDITOR_STATUS_SEGMENT.id,
        message: Segment.Message.Picked({ value: 'draft' }),
      }),
    )
    expect(picked.commands?.[0]?.name).toBe('SetEditorStatus')
    expect(picked.commands?.[0]?.args).toEqual({ id: PHOTO_ID, status: 'draft' })

    const written = update(
      picked.model,
      Message.SucceededSetEditorStatus({ id: PHOTO_ID, photo: { ...photo, status: 'draft' } }),
    )
    expect(written.model.photo?.status).toBe('draft')
    expect(dispatched(written)).toEqual([{ name: 'FetchCounts', args: undefined }])
  })

  it('does not write a Status before the Photo has loaded', () => {
    const picked = update(
      loading(),
      Message.GotSegmentMessage({
        groupId: EDITOR_STATUS_SEGMENT.id,
        message: Segment.Message.Picked({ value: 'draft' }),
      }),
    )
    expect(picked.commands ?? []).toHaveLength(0)
  })
})

describe('leaving the Editor', () => {
  it('goes at once when there is nothing unsaved', () => {
    expect(dispatched(update(opened(), Message.RequestLeaveEditor({})))).toEqual([
      { name: 'Navigate', args: { url: '/admin' } },
    ])
  })

  it('asks first, and holds the route it was opened from', () => {
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false }))
    const asked = update(dirty.model, Message.RequestLeaveEditor({}))

    // Nothing is navigated yet: the guard is open and the URL it would have
    // gone to is held, not applied.
    expect(dispatched(asked).map((entry) => entry.name)).not.toContain('Navigate')
    expect(asked.model.editor.leaveDialog.isOpen).toBe(true)
    expect(asked.model.editor.leaveUrl).toBe('/admin')

    // A second ask cannot re-arm the guard over the URL it is already holding.
    const again = update(asked.model, Message.RequestLeaveEditor({ url: '/admin/drafts' }))
    expect(again.model.editor.leaveUrl).toBe('/admin')
  })

  it('undoes a Back press rather than letting it through, and asks', () => {
    // A popstate has already moved the URL bar, and an in-app history move never
    // reaches the browser's own dialog, so the step is undone and held.
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false }))
    const pressedBack = update(dirty.model, onUrlChange(at('/admin')))

    expect(dispatched(pressedBack)[0]).toEqual({ name: 'Back', args: undefined })
    expect(pressedBack.model.editor.leaveDialog.isOpen).toBe(true)
    // Nothing was thrown away by the press: the page is still the Editor, and the
    // draft is still the draft the operator authored.
    expect(pressedBack.model.route).toEqual({ _tag: 'Photo', id: PHOTO_ID })
    expect(pressedBack.model.editor.draft?.borderEnabled).toBe(false)
  })

  it('goes to the held URL once the guard is confirmed', () => {
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false }))
    const asked = update(dirty.model, Message.RequestLeaveEditor({}))
    const confirmed = update(asked.model, Message.ConfirmedLeaveEditor({}))

    expect(dispatched(confirmed)[0]).toEqual({ name: 'Navigate', args: { url: '/admin' } })
    // The URL is spent by the leave, so a later guard cannot navigate to a
    // stale one.
    expect(confirmed.model.editor.leaveUrl).toBe('')
  })

  it('discards the draft before it navigates, so the leave survives its own URL', () => {
    const dirty = update(opened(), Message.ToggledEditorMat({ enabled: false })).model
    const asked = update(dirty, Message.RequestLeaveEditor({}))
    const confirmed = update(asked.model, Message.ConfirmedLeaveEditor({}))

    // `Discard and leave` is the guard's own discard: the authored crop is gone
    // before the `Navigate` goes out.
    expect(confirmed.model.editor.draft?.borderEnabled).toBe(true)

    // The runtime reports the pushed URL back as `ChangedUrl`, and a `Navigate`
    // made while the Editor still read as dirty was undone by its own
    // `ChangedUrl` — a `Back` and this same guard, raised again. That left the
    // operator on the page they had just agreed to leave.
    const arrived = update(confirmed.model, onUrlChange(at('/admin')))
    expect(dispatched(arrived).map((entry) => entry.name)).not.toContain('Back')
    expect(arrived.model.editor.leaveDialog.isOpen).toBe(false)
    expect(arrived.model.route).toEqual(libraryRoute(defaultLibraryFilters))
  })

  it('encodes the composition from the crop, level, mirror and Mat, not the delivery facts', () => {
    const editor = opened().editor
    expect(compositionSpec(photo, editor)?.mat).toEqual({
      colour: 'white',
      side: 0.04,
      foot: 0.04 * MAT_FOOT_MULTIPLE,
    })
    // An export override cannot move a pixel, so it cannot move the signature.
    expect(blurhashSignature(photo, withEditorExport(editor, { previewQuality: 60 }))).toBe(
      blurhashSignature(photo, editor),
    )
    // A crop does.
    const panned = { ...editor, draft: { ...PRESENTATION, cropX: 10 } }
    expect(blurhashSignature(photo, panned)).not.toBe(blurhashSignature(photo, editor))
    // A Mat toggle does: the composition loses its border.
    const noMat = { ...editor, draft: { ...PRESENTATION, borderEnabled: false } }
    expect(compositionSpec(photo, noMat)?.mat).toBeUndefined()
    expect(blurhashSignature(photo, noMat)).not.toBe(blurhashSignature(photo, editor))
    // A pan in flight is not a committed composition.
    const dragging = {
      ...editor,
      cropDrag: { x: 0, y: 0, width: 400, height: 200, startX: 0, startY: 0 },
    }
    expect(compositionSpec(photo, dragging)).toBeUndefined()
  })

  it('drops a re-encode for a composition the draft has already moved off', () => {
    const started = opened()
    const signature = blurhashSignature(started.photo, started.editor)
    const reencoded = update(
      started,
      Message.ReencodedEditorBlurhash({ id: PHOTO_ID, signature, blurhash: HASH }),
    )
    expect(reencoded.model.editor.blurhash).toBe(HASH)

    // A slow encode must not repaint the readout with a stale crop.
    const stale = update(
      reencoded.model,
      Message.ReencodedEditorBlurhash({ id: PHOTO_ID, signature: 'stale', blurhash: HASH }),
    )
    expect(stale.model.editor.blurhash).toBe(HASH)
  })
})
