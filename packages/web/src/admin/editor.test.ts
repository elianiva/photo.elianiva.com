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
import { PhotoId } from '@photo/shared'
import type { PhotoPresentation } from '@photo/shared'
import * as Animation from '@foldkit/ui/animation'
import { AcquireResources, CloseDialog, ShowDialog } from '@foldkit/ui/dialog'

import * as Dialog from '@/components/ui/dialog'

import {
  BackCmd,
  FetchPhotoCmd,
  FetchPresentationCmd,
  NavigateCmd,
  UpdateEditorCmd,
} from './commands'
import { PRESENTATION_FIELDS } from './editor'
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
} as const

/** What migration 0004 stores for a Photo nobody has edited, except that the
 *  Mat is on: the design's Editor draws one, and `borderEnabled` is the field
 *  the shell's own control writes. */
const PRESENTATION: PhotoPresentation = {
  cropX: 0,
  cropY: 0,
  cropScale: 1,
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
const matSwitch = Scene.role('switch', { name: 'Mat' })
const discard = Scene.role('button', { name: 'Discard' })
const save = Scene.role('button', { name: 'Update' })
const backLink = Scene.role('link', { name: 'Library' })

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
  Message.SucceededGetStorage({ bytes: 0, capBytes: 0 }),
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
        UpdateEditorCmd({ id: PHOTO_ID, presentation: NO_MAT }),
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
