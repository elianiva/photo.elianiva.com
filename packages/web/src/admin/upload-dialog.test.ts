/**
 * The Upload dialog's queue and copy. The run itself is the `uploadRun`
 * subscription in `subscriptions.ts` — a browser fact the Scene harness does
 * not run — so the sequencing is driven the way `update` sees it: the
 * Messages the subscription would emit, folded in order. What is asserted is
 * the Model the chain produces and the footer it prints at each step.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { PhotoId } from '@photo/shared'
import type { PhotoWithTags } from '@photo/shared'
import { FetchSettingsCmd } from './commands'
import { Message } from './model'
import type { Model } from './model'
import { init, update } from './update'
import { dialogOpened } from './scene-dialog'
import { view } from './view'
import { uploadFooterStatus, uploadFooterSummary, uploadPrimaryLabel } from './views/upload-dialog'

const ORIGIN = 'https://photo.elianiva.com'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

const PHOTO: PhotoWithTags = {
  id: PhotoId.make('photo_1'),
  slug: 'one',
  title: 'One',
  r2Key: 'originals/one.jpg',
  width: 3000,
  height: 2000,
  status: 'published',
  number: 1,
  ratio: '3:2',
  bytes: 1000,
  takenAt: '2025-08-31',
  metadata: {},
  blurhash: null,
  tags: [],
}

/** A cold `/admin` with one row, so the Library's own drop strip renders. */
const cold = (): Model =>
  [
    Message.SucceededGetSession({ email: 'owner@photo.test', teamDomain: 'https://team.test' }),
    Message.SucceededGetCounts({
      total: 1,
      trashed: 0,
      byStatus: { draft: 0, published: 1, failed: 0 },
      byTag: [],
    }),
    Message.SucceededGetStorage({ photos: 1, bytes: 1000, capBytes: 1 }),
    Message.SucceededFetchTags({ tags: [] }),
    Message.SucceededFetchPhotos({ photos: [PHOTO], nextCursor: null, total: 1 }),
  ].reduce((model, message) => update(model, message).model, init(at('/admin')).model)

const given = () => Scene.given(cold())

/** Four one-byte files through the picker's own intake, so the ids are the
 *  `${name}:${size}` keys the queue uses. */
const queued = (names: ReadonlyArray<string>): Model =>
  update(cold(), Message.ImportedFiles({ files: names.map((name) => new File(['x'], name)) })).model

const uploadingName = (model: Model): string | undefined =>
  model.queue.find((item) => item.status === 'uploading')?.name

const footer = (model: Model): string => uploadFooterStatus(uploadFooterSummary(model))

const opened = (id: string) => [
  // `Use export defaults` reads the Settings singleton; opening the dialog
  // asks for it. The resolver answers with the failure the toggle tolerates.
  Scene.Command.resolve(FetchSettingsCmd(), Message.FailedGetSettings({})),
  ...dialogOpened(id),
]

describe('the upload queue', () => {
  it('runs four items one at a time, and a failure does not stop the rest', () => {
    let model = queued(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    expect(footer(model)).toBe('0 OF 4 READY · 0 FAILED')

    model = update(model, Message.StartUploads()).model
    expect(uploadingName(model)).toBe('a.jpg')
    expect(footer(model)).toBe('0 OF 4 READY · 0 FAILED')

    // One progress tick writes the byte readout the bar is drawn from.
    model = update(model, Message.UploadProgress({ itemId: 'a.jpg:1', loaded: 1 })).model
    expect(model.queue[0]?.loaded).toBe(1)

    model = update(
      model,
      Message.SucceededUploadItem({ itemId: 'a.jpg:1', renditionsPending: false }),
    ).model
    expect(model.queue[0]?.status).toBe('done')
    expect(uploadingName(model)).toBe('b.jpg')
    expect(footer(model)).toBe('1 OF 4 READY · 0 FAILED')
    expect(uploadPrimaryLabel(uploadFooterSummary(model))).toBe('Add 4 to drafts')

    // The second file is refused; the chain still advances to the third.
    model = update(
      model,
      Message.FailedUploadItem({ itemId: 'b.jpg:1', message: 'Unsupported ratio 1:1' }),
    ).model
    expect(model.queue[1]?.status).toBe('failed')
    expect(model.queue[1]?.error).toBe('Unsupported ratio 1:1')
    expect(uploadingName(model)).toBe('c.jpg')
    expect(footer(model)).toBe('1 OF 4 READY · 1 FAILED')
    expect(uploadPrimaryLabel(uploadFooterSummary(model))).toBe('Add 3 to drafts')

    model = update(
      model,
      Message.SucceededUploadItem({ itemId: 'c.jpg:1', renditionsPending: false }),
    ).model
    expect(uploadingName(model)).toBe('d.jpg')
    expect(footer(model)).toBe('2 OF 4 READY · 1 FAILED')

    model = update(
      model,
      Message.SucceededUploadItem({ itemId: 'd.jpg:1', renditionsPending: false }),
    ).model
    expect(model.uploading).toBe(false)
    expect(footer(model)).toBe('3 OF 4 READY · 1 FAILED')
    expect(uploadPrimaryLabel(uploadFooterSummary(model))).toBe('Add 3 to drafts')
  })

  it('holds a row at processing while the renditions are still being made', () => {
    let model = queued(['a.jpg'])
    model = update(model, Message.StartUploads()).model
    model = update(
      model,
      Message.SucceededUploadItem({ itemId: 'a.jpg:1', renditionsPending: true }),
    ).model

    expect(model.queue[0]?.status).toBe('processing')
    expect(model.uploading).toBe(false)
    // A processing row is ready: its bytes are stored.
    expect(footer(model)).toBe('1 OF 1 READY · 0 FAILED')
  })

  it('keeps the frame the run measured, for the detail line', () => {
    let model = queued(['a.jpg'])
    model = update(model, Message.StartUploads()).model
    model = update(
      model,
      Message.UploadItemFacts({ itemId: 'a.jpg:1', width: 6000, height: 4000, ratio: '3:2' }),
    ).model

    expect(model.queue[0]?.width).toBe(6000)
    expect(model.queue[0]?.height).toBe(4000)
    expect(model.queue[0]?.ratio).toBe('3:2')
  })
})

describe('the upload copy', () => {
  it('names JPEG and 80 MB in the dialog, and no format it no longer takes', () => {
    Scene.scene(
      app,
      given(),
      Scene.click(Scene.role('button', { name: 'Upload' })),
      ...opened('admin-upload-dialog'),
      Scene.expect(Scene.text('Upload photographs')).toExist(),
      Scene.expect(Scene.text('JPEG only. Dimensions and EXIF are read server-side.')).toExist(),
      Scene.expect(Scene.text('JPEG · UP TO 80 MB')).toExist(),
      Scene.expectAll(Scene.all.text('PNG')).toBeEmpty(),
      Scene.expectAll(Scene.all.text('WebP')).toBeEmpty(),
      Scene.expectAll(Scene.all.text('HEIC')).toBeEmpty(),
      Scene.expectAll(Scene.all.text('TIFF')).toBeEmpty(),
    )
  })

  it('fixes the Library strip’s stale TIFF/HEIC list to JPEG only', () => {
    Scene.scene(
      app,
      given(),
      Scene.expect(Scene.text('Drop photographs to upload')).toExist(),
      Scene.expect(Scene.text('JPEG · UP TO 80 MB')).toExist(),
      Scene.expectAll(Scene.all.text('JPEG, TIFF, HEIC · UP TO 80 MB')).toBeEmpty(),
    )
  })
})
