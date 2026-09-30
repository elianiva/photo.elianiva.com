/**
 * The Editor, driven the way the operator drives it: a cold load of
 * `/admin/photos/:id`, the Mat toggle, the Stage Bar's two segments, the
 * Inspector's two tabs, and the two ways out of a dirty page.
 *
 * Every step goes through the real `init` / `update` / `view`, and every
 * response is folded through the same `update` the runtime folds Command
 * results through — so the page these scenes draw is the one the runtime would
 * have drawn.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PHOTO_RATIOS, PhotoId } from '@photo/shared'
import type { PhotoPresentation } from '@photo/shared'
import * as Animation from '@foldkit/ui/animation'
import { AcquireResources, CloseDialog, ShowDialog } from '@foldkit/ui/dialog'

import * as Dialog from '@/components/ui/dialog'
import * as Segment from '@/components/ui/segment'

import {
  BackCmd,
  FetchPhotoCmd,
  FetchPresentationCmd,
  NavigateCmd,
  UpdateEditorCmd,
} from './commands'
import {
  DETAILS_FIELDS,
  EDITOR_STATUS_SEGMENT,
  PRESENTATION_FIELDS,
  cropRatioLabel,
  cropStyle,
  detailsOfPhoto,
  fitFrameWidth,
  initEditorState,
  levelLabel,
} from './editor'
import { Message } from './model'
import type { Model } from './model'
import { init, onUrlChange, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

const PHOTO_ID = PhotoId.make('photo-1')
const EDITOR_PATH = `/admin/photos/${PHOTO_ID}`

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
  takenAt: '2025-08-31',
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

const mat = Scene.selector('[data-slot="mat"]')
const unsaved = Scene.selector('[data-slot="unsaved-kicker"]')
const cropRatio = Scene.selector('[data-slot="crop-ratio"]')
const authoredFrame = Scene.selector('[data-crop-frame]')
// The crop's pan, zoom, mirror and level are the image's own style: the frame
// is the window and the image inside it is what moves.
const authoredImage = Scene.selector('[data-crop-image]')
const originalFrame = Scene.selector('[data-slot="photograph-original"]')
const matSwitch = Scene.role('switch', { name: 'Mat' })
const discard = Scene.role('button', { name: 'Discard' })
const save = Scene.role('button', { name: 'Update' })
const backLink = Scene.role('link', { name: 'Library' })
const detailsButton = Scene.role('tab', { name: 'DETAILS' })
const detailsPanel = Scene.role('tabpanel', { name: 'DETAILS' })
const titleField = Scene.selector('#editor-title')
const placeField = Scene.selector('#editor-place')
const takenField = Scene.selector('#editor-taken')
const slugField = Scene.selector('#editor-slug')
const ratioSelect = Scene.selector('#editor-ratio')
const statusGroup = Scene.selector('[data-slot="segment"][data-id="editor-status"]')
const button = (name: string) => Scene.role('button', { name })

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
  Message.SucceededGetStorage({ photos: 0, bytes: 0, capBytes: 0 }),
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

/** What the Editor's own dialog needs answered when it opens. Its show, paint
 *  and acquire commands are the framework's business; a scene is about the
 *  app's Messages, so they are resolved by name here. */
const leaveOpened = [
  Scene.Command.resolve(
    ShowDialog({ id: 'admin-editor-leave', focusSelector: '[data-foldkit-dialog-initial-focus]' }),
    Dialog.Message.SucceededShowDialog(),
  ),
  Scene.Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint()),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: 'admin-editor-leave-panel' }),
    Animation.Message.EndedAnimation(),
  ),
  Scene.Mount.resolve(AcquireResources, Dialog.Message.SucceededAcquireResources()),
]

const leaveClosed = [
  Scene.Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint()),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: 'admin-editor-leave-panel' }),
    Animation.Message.EndedAnimation(),
  ),
  Scene.Command.resolve(
    CloseDialog({ id: 'admin-editor-leave' }),
    Dialog.Message.CompletedCloseDialog(),
  ),
]

describe('the Editor on a cold load', () => {
  it('is a document of its own — no sidebar, no Page Head, and the dark branch', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(Scene.role('heading', { name: photo.title })).toExist(),
      // The Editor is the one dark surface, and it names the branch on its own
      // root so the shell's light default cannot leak in around it.
      Scene.expect(Scene.selector('[data-slot="editor"]')).toHaveAttr('data-theme', 'dark'),
      Scene.expect(Scene.selector('[data-slot="editor-top-bar"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="editor-stage-bar"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="editor-inspector"]')).toExist(),
      // No sidebar and no Page Head anywhere: the design gives the Editor
      // neither, and a page that drew them would be the shell.
      Scene.expect(Scene.role('navigation', { name: 'Admin sections' })).not.toExist(),
      Scene.expect(Scene.selector('[data-slot="page-head"]')).not.toExist(),
    )
  })

  it('names the Photo in the Top Bar and draws the Mat around the photograph', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      // `NO. 024` is the Photo Number, zero-padded to the design's three digits.
      Scene.expect(Scene.text('NO. 024')).toExist(),
      Scene.expect(Scene.selector('[data-slot="status"][data-variant="published"]')).toExist(),
      Scene.expect(mat).toExist(),
      Scene.expect(Scene.selector('[data-slot="photograph"]')).toExist(),
      // The Mat's padding is 24/24/64/24, the design's own `gallery` geometry.
      Scene.expect(mat).toHaveStyle('padding', '24px 24px 64px 24px'),
    )
  })

  it('draws no Mat at all when the stored one is off, and no gap where it was', () => {
    Scene.scene(
      app,
      Scene.given(
        foldIn(opened(), [
          Message.SucceededFetchPresentation({ id: PHOTO_ID, presentation: NO_MAT }),
        ]),
      ),
      Scene.expect(mat).not.toExist(),
      // The photograph is still on the Stage: a Mat is a border, not a frame.
      Scene.expect(Scene.selector('[data-slot="photograph"]')).toExist(),
    )
  })

  it('sends ← Library back to the Library when the URL was typed', () => {
    Scene.scene(app, Scene.given(opened()), Scene.expect(backLink).toHaveAttr('href', '/admin'))
  })

  it('sends ← Library back to the route the Editor was opened from', () => {
    Scene.scene(
      app,
      Scene.given(reachedFrom('/admin/drafts')),
      Scene.expect(backLink).toHaveAttr('href', '/admin/drafts'),
    )
  })

  it('draws two Inspector tabs and not the deferred HISTORY one', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(Scene.role('tab', { name: 'EDIT' })).toHaveAttr('aria-selected', 'true'),
      Scene.expect(Scene.role('tab', { name: 'DETAILS' })).toHaveAttr('aria-selected', 'false'),
      // Decision 8: no third tab, not even a disabled one.
      Scene.expect(Scene.role('tab', { name: 'HISTORY' })).not.toExist(),
      Scene.expect(Scene.text('HISTORY')).not.toExist(),
    )
  })

  it('switches Inspector tabs, and DETAILS prints the record it has', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(Scene.role('tab', { name: 'DETAILS' })),
      Scene.expect(Scene.role('tabpanel', { name: 'DETAILS' })).toExist(),
      // The Photo Number is a fact, not a control: no control may edit it.
      Scene.expect(Scene.text('NO. 024 · SET AT UPLOAD · NEVER REUSED')).toExist(),
      Scene.expect(Scene.role('tabpanel', { name: 'EDIT' })).not.toExist(),
    )
  })

  it('opens on the design’s Stage Bar picks and moves each segment on its own', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(Scene.role('button', { name: 'FIT' })).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(Scene.role('button', { name: 'EXPORT' })).toHaveAttr('aria-pressed', 'true'),
      Scene.click(Scene.role('button', { name: 'ORIGINAL' })),
      Scene.expect(Scene.role('button', { name: 'ORIGINAL' })).toHaveAttr('aria-pressed', 'true'),
      // The Zoom group did not move with the Compare group.
      Scene.expect(Scene.role('button', { name: 'FIT' })).toHaveAttr('aria-pressed', 'true'),
      // `ORIGINAL` is the file as the camera made it, so there is no Mat.
      Scene.expect(Scene.selector('[data-slot="photograph-original"]')).toExist(),
    )
  })

  it('draws the split, and looking at a Photo changes nothing about it', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(Scene.role('button', { name: 'SPLIT' })),
      Scene.expect(Scene.selector('[data-slot="compare-split"]')).toExist(),
      Scene.expect(Scene.selector('[data-slot="photograph-original"]')).toExist(),
      Scene.expect(mat).toExist(),
      // A Zoom and a Compare mode are view state: neither is a change to the
      // Photo, so the unsaved indicator must not have appeared.
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(discard).toBeDisabled(),
      Scene.expect(save).toBeDisabled(),
    )
  })

  it('says it is loading while its own reads are in flight', () => {
    Scene.scene(
      app,
      Scene.given(loading()),
      Scene.expect(Scene.selector('[data-slot="editor-loading"]')).toExist(),
      Scene.expect(mat).not.toExist(),
      // Nothing can be saved from a page that has not read the Photo yet.
      Scene.expect(save).toBeDisabled(),
    )
  })

  it('offers a retry when a read fails, and keeps its own frame', () => {
    const failed = foldIn(loading(), [Message.FailedFetchPhoto({ id: PHOTO_ID, message: 'gone' })])
    Scene.scene(
      app,
      Scene.given(failed),
      Scene.expect(Scene.selector('[data-slot="editor-error"]')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Retry' })).toExist(),
      // The Top Bar survives the error: it is the Editor's own frame, and a
      // page that loses its frame mid-load reads as a different page.
      Scene.expect(Scene.selector('[data-slot="editor-top-bar"]')).toExist(),
    )
  })

  it('re-reads the Photo and its Presentation when the operator retries', () => {
    const failed = foldIn(loading(), [Message.FailedFetchPhoto({ id: PHOTO_ID, message: 'gone' })])
    Scene.scene(
      app,
      Scene.given(failed),
      Scene.click(Scene.role('button', { name: 'Retry' })),
      // Either read failing leaves the Editor with nothing to draw, so a retry
      // is both of them rather than whichever one failed.
      Scene.Command.resolveAll(
        [FetchPhotoCmd({ id: PHOTO_ID }), Message.SucceededFetchPhoto({ id: PHOTO_ID, photo })],
        [
          FetchPresentationCmd({ id: PHOTO_ID }),
          Message.SucceededFetchPresentation({ id: PHOTO_ID, presentation: PRESENTATION }),
        ],
      ),
      Scene.expect(mat).toExist(),
    )
  })
})

describe('the unsaved-changes indicator', () => {
  it('appears on a change and goes on Discard, which puts the Mat back', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(unsaved).not.toExist(),
      Scene.click(matSwitch),
      // The draft is what the Stage draws, so the change is visible before it
      // is saved: the Mat is gone from the Stage in the same step.
      Scene.expect(mat).not.toExist(),
      Scene.expect(unsaved).toExist(),
      Scene.expect(Scene.selector('[data-slot="unsaved-dot"]')).toExist(),
      Scene.expect(discard).toBeEnabled(),
      Scene.expect(save).toBeEnabled(),
      Scene.click(discard),
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(Scene.selector('[data-slot="unsaved-dot"]')).not.toExist(),
      // Fully reverted: the loaded value is back, not merely the indicator.
      Scene.expect(mat).toExist(),
      Scene.expect(discard).toBeDisabled(),
      Scene.expect(save).toBeDisabled(),
    )
  })

  it('clears off the stored truth the save answered with, not off the request', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(matSwitch),
      Scene.click(save),
      // The resolver matches on the command's arguments, so a patch that sent
      // only the Mat would leave this unresolved and the scene would fail.
      Scene.Command.resolve(
        UpdateEditorCmd({ id: PHOTO_ID, presentation: NO_MAT, savePresentation: true }),
        Message.UpdatedEditor({ id: PHOTO_ID, presentation: NO_MAT }),
      ),
      Scene.expect(unsaved).not.toExist(),
      // The Stage keeps drawing the answer, so a value the service changed
      // comes back as what it stored rather than as what was sent.
      Scene.expect(mat).not.toExist(),
      Scene.expect(matSwitch).not.toHaveAttr('data-checked'),
    )
  })

  it('sends nothing to save when there is nothing to save', () => {
    // `Update` is disabled while clean, so a save with no change cannot be
    // dispatched at all. Asserted on the message rather than the button
    // because that is the invariant a later panel could break.
    const clean = update(opened(), Message.SubmitEditorUpdate())
    expect(clean.commands ?? []).toHaveLength(0)
    expect(clean.model.editor.saving).toBe(false)
  })

  it('watches every stored field of the Presentation, both ways', () => {
    // The dirty rule is a comparison against a field list, so a field the list
    // forgot is a value the indicator would silently ignore. `keyof` catches a
    // misspelling at compile time; this catches an omission.
    expect([...PRESENTATION_FIELDS].sort()).toEqual(Object.keys(PRESENTATION).sort())
  })

  it('watches every stored field of the record, both ways', () => {
    expect([...DETAILS_FIELDS].sort()).toEqual(Object.keys(detailsOfPhoto(photo)).sort())
  })
})

describe('the DETAILS record', () => {
  it('draws the record from the stored columns, with no SERIES Select', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(detailsButton),
      Scene.expect(detailsPanel).toExist(),
      // Every value comes off the loaded Photo, not a specimen.
      Scene.expect(titleField).toHaveValue(photo.title),
      Scene.expect(placeField).toHaveValue('Kota Tua, Jakarta'),
      Scene.expect(takenField).toHaveValue('2025-08-31'),
      Scene.expect(slugField).toHaveValue(photo.slug),
      Scene.expect(ratioSelect).toHaveValue('3:2'),
      Scene.expect(statusGroup).toExist(),
      // The superseded SERIES Select is gone, with no empty row in its place:
      // PLACE is `metadata.location`, so its row and TAKEN sit adjacent.
      Scene.expect(Scene.text('SERIES')).not.toExist(),
      // The Top Bar owns the save, so the panel draws no footer of its own.
      Scene.expect(
        Scene.within(detailsPanel, Scene.role('button', { name: 'Update' })),
      ).not.toExist(),
      Scene.expect(
        Scene.within(detailsPanel, Scene.role('button', { name: 'Discard' })),
      ).not.toExist(),
    )
  })

  it('marks the Editor dirty on a record change and sends UpdatePhoto on save', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(detailsButton),
      Scene.type(titleField, 'Another title'),
      Scene.expect(unsaved).toExist(),
      Scene.click(save),
      Scene.Command.resolve(
        UpdateEditorCmd({
          id: PHOTO_ID,
          presentation: PRESENTATION,
          savePresentation: false,
          details: {
            title: 'Another title',
            slug: photo.slug,
            location: 'Kota Tua, Jakarta',
            takenAt: photo.takenAt,
          },
          metadata: { location: 'Kota Tua, Jakarta' },
        }),
        Message.UpdatedEditor({
          id: PHOTO_ID,
          presentation: PRESENTATION,
          photo: { ...photo, title: 'Another title' },
        }),
      ),
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(titleField).toHaveValue('Another title'),
    )
  })

  it('puts the stored record back when Discard is pressed', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(detailsButton),
      Scene.type(titleField, 'Another title'),
      Scene.expect(unsaved).toExist(),
      Scene.click(discard),
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(titleField).toHaveValue(photo.title),
    )
  })

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
    expect((written.commands ?? []).map((command) => command.name)).toEqual(['FetchCounts'])
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
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.Subscription.emit(Message.RequestLeaveEditor({})),
      Scene.Command.resolve(NavigateCmd({ url: '/admin' }), Message.CompletedNavigate()),
    )
  })

  it('asks first, and puts the URL back, when the draft differs from the snapshot', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(matSwitch),
      // A Back press is a popstate: the URL bar has already moved, so the
      // guard undoes the step rather than leaving a trail of entries behind.
      Scene.Subscription.emit(onUrlChange(at('/admin'))),
      Scene.Command.resolve(BackCmd, Message.CompletedNavigate()),
      ...leaveOpened,
      Scene.expect(Scene.role('dialog')).toExist(),
      Scene.expect(Scene.text('Unsaved changes')).toExist(),
      // Nothing was thrown away by the press: the page is still the Editor and
      // the draft is still unsaved.
      Scene.expect(matSwitch).toExist(),
      Scene.expect(unsaved).toExist(),
      Scene.click(Scene.role('button', { name: 'Discard and leave' })),
      Scene.Command.resolve(NavigateCmd({ url: '/admin' }), Message.CompletedNavigate()),
      ...leaveClosed,
      Scene.Mount.expectEnded(AcquireResources),
    )
  })

  it('keeps the edits when the guard is dismissed', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(matSwitch),
      Scene.Subscription.emit(onUrlChange(at('/admin'))),
      Scene.Command.resolve(BackCmd, Message.CompletedNavigate()),
      ...leaveOpened,
      Scene.click(Scene.role('button', { name: 'Keep editing' })),
      ...leaveClosed,
      // Still dirty, still no Mat: "keep editing" lost nothing, and the guard's
      // content is gone rather than merely hidden.
      Scene.expect(unsaved).toExist(),
      Scene.expect(mat).not.toExist(),
      Scene.expect(Scene.role('button', { name: 'Keep editing' })).not.toExist(),
      Scene.Mount.expectEnded(AcquireResources),
    )
  })
})

// ---------------------------------------------------------------------------
// the Crop section
// ---------------------------------------------------------------------------

/** The Stage's authored frame with a crop set, as the snapshot read would
 *  deliver it. Pan, zoom and a mirror are all on one frame so every part of
 *  the style is exercised in one render. */
const CROPPED: PhotoPresentation = {
  ...PRESENTATION,
  cropX: 10,
  cropY: -5,
  cropScale: 2,
  cropFlipX: true,
}

const withPresentation = (presentation: PhotoPresentation): Model =>
  foldIn(opened(), [Message.SucceededFetchPresentation({ id: PHOTO_ID, presentation })])

describe('the Crop section', () => {
  it('heads with the as-shot Ratio, draws six of them and the three transforms', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(Scene.text('CROP')).toExist(),
      Scene.expect(cropRatio).toHaveText('3:2 · AS SHOT'),
      Scene.expect(Scene.role('group', { name: 'Ratio' })).toExist(),
      ...PHOTO_RATIOS.map((ratio) => Scene.expect(button(ratio)).toExist()),
      Scene.expect(button('3:2')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(button('4:3')).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(button('Straighten clockwise')).toExist(),
      Scene.expect(button('Straighten counter-clockwise')).toExist(),
      Scene.expect(button('Flip horizontally')).toExist(),
      Scene.expect(Scene.text('LEVEL 0.0°')).toExist(),
    )
  })

  it('re-crops when a Ratio is picked, and the head stops claiming AS SHOT', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(button('4:3')),
      Scene.expect(cropRatio).toHaveText('4:3'),
      Scene.expect(button('4:3')).toHaveAttr('aria-pressed', 'true'),
      // The plate is the authored Ratio, not the source's own.
      Scene.expect(authoredFrame).toHaveStyle('aspect-ratio', '4 / 3'),
      Scene.expect(unsaved).toExist(),
    )
  })

  it('sizes the plate at FIT, so the crop cannot collapse to nothing', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.expect(authoredFrame).toHaveStyle(
        'width',
        'min(calc(100vw - 29.5rem), calc((100dvh - 16rem) * 1.5))',
      ),
    )
  })

  it('treats a pick that lands back on the as-shot Ratio as no change', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(button('4:3')),
      Scene.expect(unsaved).toExist(),
      Scene.click(button('3:2')),
      Scene.expect(cropRatio).toHaveText('3:2 · AS SHOT'),
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(discard).toBeDisabled(),
      Scene.expect(save).toBeDisabled(),
    )
  })

  it('steps the level by a tenth of a degree, in both directions', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(button('Straighten clockwise')),
      Scene.expect(Scene.text('LEVEL +0.1°')).toExist(),
      Scene.click(button('Straighten clockwise')),
      Scene.expect(Scene.text('LEVEL +0.2°')).toExist(),
      Scene.click(button('Straighten counter-clockwise')),
      Scene.expect(Scene.text('LEVEL +0.1°')).toExist(),
      Scene.expect(authoredImage).toHaveStyle('transform', 'scale(1.0026) rotate(0.1deg)'),
      Scene.expect(unsaved).toExist(),
    )
  })

  it('mirrors the frame, and the button says it is on', () => {
    Scene.scene(
      app,
      Scene.given(withPresentation(CROPPED)),
      Scene.expect(button('Flip horizontally')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(authoredImage).toHaveStyle('object-position', '60% 45%'),
      Scene.expect(authoredImage).toHaveStyle('transform', 'scale(2) scaleX(-1)'),
      Scene.click(button('Flip horizontally')),
      Scene.expect(button('Flip horizontally')).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(authoredImage).toHaveStyle('transform', 'scale(2)'),
    )
  })

  it('keeps ORIGINAL the source as shot and applies the crop to EXPORT and SPLIT', () => {
    Scene.scene(
      app,
      Scene.given(withPresentation(CROPPED)),
      // EXPORT is the design's default and is the crop.
      Scene.expect(authoredFrame).toExist(),
      Scene.expect(authoredImage).toHaveStyle('object-position', '60% 45%'),
      Scene.click(button('ORIGINAL')),
      Scene.expect(originalFrame).toExist(),
      Scene.expect(authoredFrame).not.toExist(),
      Scene.click(button('SPLIT')),
      Scene.expect(Scene.selector('[data-slot="compare-split"]')).toExist(),
      Scene.expect(originalFrame).toExist(),
      // Both halves of the Split, and the authored one is still the crop.
      Scene.expect(authoredImage).toHaveStyle('object-position', '60% 45%'),
      Scene.expect(authoredImage).toHaveStyle('transform', 'scale(2) scaleX(-1)'),
    )
  })

  it('pans by drag and zooms by wheel, and draws both on the Stage', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.Subscription.emit(
        Message.StartedEditorCropDrag({ x: 100, y: 100, width: 400, height: 200 }),
      ),
      Scene.Subscription.emit(Message.DraggedEditorCrop({ x: 140, y: 80 })),
      // Dragging the photograph right and up moves the window with the pointer.
      Scene.expect(authoredImage).toHaveStyle('object-position', '40% 60%'),
      Scene.Subscription.emit(Message.EndedEditorCropDrag()),
      Scene.Subscription.emit(Message.ZoomedEditorCrop({ deltaY: -100 })),
      Scene.expect(authoredImage).toHaveStyle('transform', 'scale(1.1)'),
      Scene.expect(unsaved).toExist(),
    )
  })

  it('saves the Ratio through UpdatePhoto and the crop through UpdatePhotoPresentation', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(button('4:3')),
      Scene.click(save),
      // A Ratio-only save must not rewrite the crop: `savePresentation` is
      // false, so the command carries the untouched Presentation and the pick.
      Scene.Command.resolve(
        UpdateEditorCmd({
          id: PHOTO_ID,
          presentation: PRESENTATION,
          ratio: '4:3',
          savePresentation: false,
        }),
        Message.UpdatedEditor({
          id: PHOTO_ID,
          presentation: PRESENTATION,
          photo: { ...photo, ratio: '4:3' },
        }),
      ),
      Scene.expect(unsaved).not.toExist(),
      Scene.expect(cropRatio).toHaveText('4:3'),
      Scene.expect(save).toBeDisabled(),
    )
  })

  it('reverts the Ratio, the flip and a half-drag on Discard', () => {
    Scene.scene(
      app,
      Scene.given(opened()),
      Scene.click(button('4:3')),
      Scene.click(button('Flip horizontally')),
      Scene.Subscription.emit(
        Message.StartedEditorCropDrag({ x: 0, y: 0, width: 400, height: 200 }),
      ),
      Scene.Subscription.emit(Message.DraggedEditorCrop({ x: 40, y: 0 })),
      Scene.expect(authoredImage).toHaveStyle('object-position', '40% 50%'),
      Scene.click(discard),
      Scene.expect(cropRatio).toHaveText('3:2 · AS SHOT'),
      Scene.expect(button('Flip horizontally')).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(authoredImage).toHaveStyle('object-position', '50% 50%'),
      Scene.expect(unsaved).not.toExist(),
    )
  })
})

describe('the Crop copy', () => {
  it('names AS SHOT only while the frame is the one the camera made', () => {
    const editor = initEditorState()
    expect(cropRatioLabel(photo, editor)).toBe('3:2 · AS SHOT')
    expect(cropRatioLabel(photo, { ...editor, ratio: '4:3' })).toBe('4:3')
  })

  it('prints the level at the step\u2019s own precision, signed', () => {
    expect(levelLabel({ ...PRESENTATION, level: null })).toBe('LEVEL 0.0°')
    expect(levelLabel({ ...PRESENTATION, level: 0.4 })).toBe('LEVEL +0.4°')
    expect(levelLabel({ ...PRESENTATION, level: -0.3 })).toBe('LEVEL -0.3°')
  })

  it('leaves an un-cropped frame at scale one', () => {
    expect(cropStyle(PRESENTATION, '3 / 2')).toEqual({
      'object-position': '50% 50%',
      transform: 'scale(1)',
    })
  })

  it('grows the frame by the level so a straighten cannot show the surface', () => {
    expect(cropStyle({ ...PRESENTATION, level: 1 }, '3 / 2').transform).toBe(
      'scale(1.026) rotate(1deg)',
    )
  })

  it('fits the plate to the smaller of the Stage’s width and height', () => {
    expect(fitFrameWidth('3 / 2')).toBe('min(calc(100vw - 29.5rem), calc((100dvh - 16rem) * 1.5))')
    expect(fitFrameWidth('2 / 3')).toBe(
      'min(calc(100vw - 29.5rem), calc((100dvh - 16rem) * 0.6667))',
    )
  })
})
