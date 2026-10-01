/**
 * The Editor's own data and state (`/admin/photos/<id>`): the state it opens
 * in, the two Segment groups the Stage Bar draws, the dirty rule, and the
 * geometry the Stage derives from a Photo and its draft Presentation.
 *
 * It sits beside `update.ts` rather than inside the view because the update
 * core initialises the Model from it and must not import views — the same
 * split `atoms-sheet.ts` and `views/atoms.ts` make.
 *
 * Two decisions are recorded here rather than only in the view, because both
 * are rules rather than layout:
 *
 * - **Dirty is "any stored field differs from the loaded snapshot."** Not
 *   "some field was touched": a deep comparison needs no touched-set to keep
 *   in step, so `Discard` is exactly "put the snapshot back" and there is no
 *   way for the indicator and the values to disagree.
 * - **The Stage draws the draft, not the snapshot.** An authored change is
 *   visible before it is saved, which is the whole reason `Discard` and
 *   `Update` exist as a pair.
 */

import { PHOTO_RATIOS, PHOTO_STATUSES, nearestRatio, ratioAspect } from '@photo/shared'
import type {
  PhotoMetadata,
  PhotoPresentation,
  PhotoRatio,
  PhotoStatus,
  PhotoWithTags,
} from '@photo/shared'

import * as Dialog from '@/components/ui/dialog'
import * as Segment from '@/components/ui/segment'
import type { CompositionSpec } from '@/lib/blurhash'

import { AppRoute, appRouteToUrl, libraryRoute, libraryUrl } from './route'
import type { EditorState, PhotoDetails } from './model'

// ---------------------------------------------------------------------------
// the state it opens in
// ---------------------------------------------------------------------------

/** The design's Stage Bar: `FIT 50% 100% 200%` with `FIT` picked. A zoom is
 *  view state, not an authored value — nothing about a Photo changes when the
 *  operator looks at it larger, so none of it is dirty-able. */
export const ZOOM_OPTIONS = ['fit', '50', '100', '200'] as const
export type EditorZoom = (typeof ZOOM_OPTIONS)[number]

/** `ORIGINAL SPLIT EXPORT` with `EXPORT` picked, the design's default. What the
 *  Stage shows, not a stored fact either. */
export const COMPARE_OPTIONS = ['original', 'split', 'export'] as const
export type EditorCompare = (typeof COMPARE_OPTIONS)[number]

export const initEditorState = (): EditorState => ({
  tab: 'edit',
  saving: false,
  detailsSnapshot: undefined,
  detailsDraft: undefined,
  // A cold load of the Editor's URL was not opened from a list, so the honest
  // answer is the Library. `ChangedUrl` records the real one when there is one.
  returnRoute: libraryRoute(),
  leaveDialog: Dialog.init({ id: 'admin-editor-leave' }),
  leaveUrl: '',
})

// ---------------------------------------------------------------------------
// the Stage Bar's two Segment groups
// ---------------------------------------------------------------------------

/** One Stage Bar group: its slot id, the design's first pick, and the options
 *  it draws. The same shape `atoms-sheet.ts` uses for the sheet's groups. */
export type EditorSegmentGroup = Segment.ViewInputs & {
  readonly id: string
  readonly selected: string
}

export const ZOOM_SEGMENT = {
  id: 'editor-zoom',
  selected: 'fit',
  ariaLabel: 'Zoom',
  options: [
    { value: 'fit', label: 'FIT' },
    { value: '50', label: '50%' },
    { value: '100', label: '100%' },
    { value: '200', label: '200%' },
  ],
} as const satisfies EditorSegmentGroup

export const COMPARE_SEGMENT = {
  id: 'editor-compare',
  selected: 'export',
  ariaLabel: 'Compare',
  options: [
    { value: 'original', label: 'ORIGINAL' },
    { value: 'split', label: 'SPLIT' },
    { value: 'export', label: 'EXPORT' },
  ],
} as const satisfies EditorSegmentGroup

/** The design's two groups, in the design's own order. The `Segment` atom is
 *  the one stateful atom in the set, so these are groups in the shared
 *  `segmentGroups` record rather than two fields on the Editor. */
/** The `DETAILS` tab's three stored Statuses, in lifecycle order. This is the
 *  same `Segment` atom as the Filter Bar's status group with a different value
 *  set: the design draws `DRAFT · SCHEDULED · PUBLISHED`, but `scheduled` is a
 *  display-only label over a draft with a publish time and nothing records one
 *  (CONTEXT.md, Status), so it is not a value `SetPhotoStatus` can write. The
 *  third stored value, `failed`, takes its place — the three columns the
 *  CHECK allows are the three the group offers.
 *
 *  The selection is written by `update.ts` through `SetPhotoStatus`, not by
 *  `UpdatePhoto`: a Status is a lifecycle move, not a field on the record. */
export const EDITOR_STATUS_SEGMENT = {
  id: 'editor-status',
  selected: 'draft',
  ariaLabel: 'Status',
  options: [
    { value: 'draft', label: 'DRAFT' },
    { value: 'published', label: 'PUBLISHED' },
    { value: 'failed', label: 'FAILED' },
  ],
} as const satisfies EditorSegmentGroup

/** The design's two Stage Bar groups plus the `DETAILS` tab's Status group. The
 *  `Segment` atom is the one stateful atom in the set, so these are groups in
 *  the shared `segmentGroups` record rather than fields on the Editor. */
export const editorSegments: ReadonlyArray<EditorSegmentGroup> = [
  ZOOM_SEGMENT,
  COMPARE_SEGMENT,
  EDITOR_STATUS_SEGMENT,
]

/** The Crop section's six-Ratio `Segment`. Unlike the Stage Bar's two groups
 *  this one is not a view mode: its pick is authored data, and its selection
 *  is derived from the draft rather than kept in the shared record, so a save
 *  or a `Discard` moves it without a second write to keep in step. */
export const CROP_RATIO_SEGMENT = {
  id: 'editor-crop-ratio',
  ariaLabel: 'Ratio',
  options: PHOTO_RATIOS.map((ratio) => ({ value: ratio, label: ratio })),
} as const satisfies {
  readonly id: string
  readonly ariaLabel: string
  readonly options: ReadonlyArray<Segment.SegmentOption>
}

export const initEditorSegments = (): Segment.Groups =>
  Segment.initGroups(editorSegments.map(({ id, selected }) => ({ id, selected })))

/** Does the group offer this value? A type predicate rather than a cast, so a
 *  pick that is somehow not one of the group's own options falls back to the
 *  design's default instead of typing its way into the view. */
const offersValue = <T extends string>(group: EditorSegmentGroup, value: string): value is T =>
  group.options.some((option) => option.value === value)

/** One group's current pick, typed as that group's own value set, or the
 *  design's default when the Model holds no state for it or holds a pick that
 *  is not on offer — the same fallback the atoms sheet uses, so a group can
 *  never render with nothing selected. */
export const editorSegmentSelected = <T extends string>(
  groups: Segment.Groups,
  group: EditorSegmentGroup & { readonly selected: T },
): T => {
  const picked = Segment.readGroup(groups, group.id)?.selected
  return picked !== undefined && offersValue<T>(group, picked) ? picked : group.selected
}

// ---------------------------------------------------------------------------
// the dirty rule
// ---------------------------------------------------------------------------

/** Every stored field of the Presentation. A `keyof` annotation makes a
 *  misspelled field a compile error. */
const PRESENTATION_FIELDS: ReadonlyArray<keyof PhotoPresentation> = [
  'cropX',
  'cropY',
  'cropScale',
  'cropFlipX',
  'level',
  'borderEnabled',
  'borderStyle',
  'borderColour',
  'borderWidth',
  'previewLongEdge',
  'previewFormat',
  'previewQuality',
  'fullQuality',
  'keepExif',
  'removeGps',
] satisfies ReadonlyArray<keyof PhotoPresentation>

/** Whether the draft has moved off the snapshot. False before either is
 *  loaded: an Editor with no Presentation in it has nothing it could have
 *  changed, and claiming otherwise would light the indicator on every cold
 *  load. A Ratio override is a change on its own — it is another stored fact
 *  the same `Update` commits — so it is checked first, and the `DETAILS`
 *  record is a third fact. */
export const isEditorDirty = (editor: EditorState): boolean => {
  if (editor.ratio !== undefined) return true
  if (isPresentationDirty(editor)) return true
  return isDetailsDirty(editor)
}

/** Whether the Presentation itself has moved, as opposed to the Ratio override
 *  beside it. The save command needs the two apart: a Ratio-only save must not
 *  rewrite the crop, because a crop write is a Rendition regeneration (#35). */
export const isPresentationDirty = (editor: EditorState): boolean => {
  const { snapshot, draft } = editor
  if (snapshot === undefined || draft === undefined) return false
  return PRESENTATION_FIELDS.some((field) => snapshot[field] !== draft[field])
}

/** Whether the `DETAILS` record has moved. Its own pair of snapshot/draft, so
 *  a title edit lights the same indicator and guards the same leave as a crop
 *  edit, without being a field of the Presentation. */
export const isDetailsDirty = (editor: EditorState): boolean => {
  const { detailsSnapshot, detailsDraft } = editor
  if (detailsSnapshot === undefined || detailsDraft === undefined) return false
  return DETAILS_FIELDS.some((field) => detailsSnapshot[field] !== detailsDraft[field])
}

/** The Editor's copy of the Presentation, with the Mat's on/off replaced.
 *  Returns the state unchanged while there is no draft to change, so a toggle
 *  that arrives before the read answers is dropped rather than resurrecting a
 *  half-built Presentation the server never sent. */
export const withEditorMat = (editor: EditorState, enabled: boolean): EditorState =>
  editor.draft === undefined
    ? editor
    : { ...editor, draft: { ...editor.draft, borderEnabled: enabled } }

/** The six export override fields the Export panel edits, as one patch. They
 *  are all Presentation columns, so a write is a field on the draft exactly
 *  like the Mat's. */
export type EditorExportPatch = Partial<
  Pick<
    PhotoPresentation,
    | 'previewLongEdge'
    | 'previewFormat'
    | 'previewQuality'
    | 'fullQuality'
    | 'keepExif'
    | 'removeGps'
  >
>

/** Write one or more export overrides on the draft. A control that fires
 *  before the Presentation read answers is dropped rather than resurrecting a
 *  half-built draft. */
export const withEditorExport = (editor: EditorState, patch: EditorExportPatch): EditorState =>
  editor.draft === undefined ? editor : { ...editor, draft: { ...editor.draft, ...patch } }

/** The `DETAILS` tab's editable fields, the counterpart of
 *  `PRESENTATION_FIELDS`. The Ratio override is deliberately not one of them:
 *  it is `editor.ratio`, beside the draft rather than inside the record. */
const DETAILS_FIELDS: ReadonlyArray<keyof PhotoDetails> = [
  'title',
  'slug',
  'location',
  'takenAt',
] satisfies ReadonlyArray<keyof PhotoDetails>

/** The `DETAILS` values a Photo carries. `location` is lifted out of the
 *  metadata blob because the blob's key is optional and the panel edits a
 *  string; `takenAt` is a nullable column and a cleared field is the empty
 *  string the panel can put back. */
export const detailsOfPhoto = (photo: PhotoWithTags): PhotoDetails => ({
  title: photo.title,
  slug: photo.slug,
  location: photo.metadata?.location ?? '',
  takenAt: photo.takenAt ?? '',
})

/** Write a `DETAILS` field on the draft. A control that fires before the Photo
 *  read answers is dropped rather than resurrecting a half-built record. */
export const withEditorDetails = (
  editor: EditorState,
  patch: Partial<PhotoDetails>,
): EditorState =>
  editor.detailsDraft === undefined
    ? editor
    : { ...editor, detailsDraft: { ...editor.detailsDraft, ...patch } }

/** The metadata blob a `DETAILS` save sends. `UpdatePhoto` replaces the whole
 *  blob, so the fields the panel does not edit — caption, camera, lens — are
 *  carried rather than dropped, and a cleared location removes the key rather
 *  than storing an empty string (CONTEXT.md: a fact the Photo does not carry is
 *  absent, never a blank). */
export const metadataWithLocation = (
  metadata: PhotoMetadata | undefined,
  location: string,
): PhotoMetadata => {
  const base = metadata ?? {}
  const carried: PhotoMetadata = {
    ...(base.caption === undefined ? {} : { caption: base.caption }),
    ...(base.camera === undefined ? {} : { camera: base.camera }),
    ...(base.lens === undefined ? {} : { lens: base.lens }),
  }
  return location === '' ? carried : { ...carried, location }
}

/** The stored Statuses widened to `string`, so the guard can ask whether an
 *  arbitrary pick is one of them without an assertion. */
const PHOTO_STATUS_VALUES: ReadonlyArray<string> = PHOTO_STATUSES

/** Is this a stored Status? The Status group's `Picked` value arrives as a
 *  string and the write is typed, so a value the column's CHECK would reject
 *  falls back to a no-op. */
export const isPhotoStatus = (value: string): value is PhotoStatus =>
  PHOTO_STATUS_VALUES.includes(value)

/** `3:2 · HORIZONTAL` — the `DETAILS` tab's Ratio option copy. The Crop
 *  section's own Segment prints the bare Ratio; the record's Select spells the
 *  orientation out. It is read off the reduced fraction rather than stored, so
 *  the six ratios are one table and a label cannot disagree with the frame. */
export const ratioOptionLabel = (ratio: PhotoRatio): string => {
  const [width, height] = ratio.split(':')
  return `${ratio} · ${Number(width) >= Number(height) ? 'HORIZONTAL' : 'VERTICAL'}`
}

/** Put the Status group's selection on the stored Status, so the segment draws
 *  the Photo's own fact rather than the last thing the operator clicked. Called
 *  when the Photo loads and after a status write answers. */
export const withEditorStatusSelected = (
  groups: Segment.Groups,
  status: PhotoStatus,
): Segment.Groups =>
  Segment.writeGroup(groups, EDITOR_STATUS_SEGMENT.id, {
    id: EDITOR_STATUS_SEGMENT.id,
    selected: status,
  })

// ---------------------------------------------------------------------------
// the Crop's authored facts
// ---------------------------------------------------------------------------

/** How far one straighten click turns the frame. The design's readout is
 *  `+0.4°`, so the step is a tenth of a degree: the readout's own precision. */
export const LEVEL_STEP = 0.1

/** A straighten beyond this is not a straighten, it is a rotation, and the
 *  design has no control for one. Clamping keeps the frame recognisable. */
export const LEVEL_LIMIT = 45

/** The crop window's zoom. `1` is the source fitted to the Ratio; below it the
 *  window would be smaller than the frame and show the Mat through the gap, so
 *  it is the floor. */
export const CROP_SCALE_MIN = 1
export const CROP_SCALE_MAX = 4

/** How far the source may be panned, as a percentage of the frame. The style
 *  reads it as `50 + cropX`, so `50` is an edge of the source against an edge
 *  of the frame and anything past it would show background. */
export const CROP_PAN_LIMIT = 50

/** One wheel notch's zoom. A trackpad sends many small deltas and a mouse one
 *  large one, so the step is per event rather than scaled by the delta. */
export const CROP_ZOOM_STEP = 1.1

const roundTo = (value: number, places: number): number => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

/** Is this one of the six supported Ratios? A type predicate rather than a
 *  cast, so a `Segment` pick that somehow carries a value the group does not
 *  offer falls back to no change instead of typing its way into the draft. */
export const isPhotoRatio = (value: string): value is PhotoRatio =>
  PHOTO_RATIOS.some((ratio) => ratio === value)

/** The Ratio the Stage frames: the draft's pick, else the Photo's stored one,
 *  else the source's own nearest supported proportion — which is what the
 *  upload snap would have stored and is therefore the honest fallback for a row
 *  the backfill has not reached. `null` when the source matches none of the
 *  six, which is `as shot` in the source's own proportion. */
export const effectiveRatio = (
  photo: PhotoWithTags | undefined,
  editor: EditorState,
): PhotoRatio | null => {
  if (editor.ratio !== undefined) return editor.ratio
  if (photo === undefined) return null
  return photo.ratio ?? nearestRatio(photo.width, photo.height)
}

/** The proportion the camera made, which is what `AS SHOT` names. Derived from
 *  the measured frame rather than stored twice: it is the same `nearestRatio`
 *  the upload snap ran, so the two cannot disagree. */
export const asShotRatio = (photo: PhotoWithTags): PhotoRatio | null =>
  nearestRatio(photo.width, photo.height)

/** The Crop head's right half: `<ratio> · AS SHOT` while the frame is the one
 *  the camera made, and just `<ratio>` once the operator has re-cropped it. The
 *  empty string while there is no Photo to name. */
export const cropRatioLabel = (photo: PhotoWithTags | undefined, editor: EditorState): string => {
  const ratio = effectiveRatio(photo, editor)
  if (ratio === null) return ''
  const asShot = photo === undefined ? null : asShotRatio(photo)
  return ratio === asShot ? `${ratio} · AS SHOT` : ratio
}

/** The Transform row's readout: `LEVEL +0.4°`, one decimal because that is the
 *  step, and a leading `+` so a positive angle reads as signed. A stored null
 *  is un-levelled and prints `0.0°`, which is what it looks like. */
export const levelLabel = (presentation: PhotoPresentation): string => {
  const level = presentation.level ?? 0
  return `LEVEL ${level > 0 ? '+' : ''}${level.toFixed(1)}°`
}

/** Pick a Ratio. A pick that lands back on the Photo's stored Ratio clears the
 *  override rather than recording a no-op change, so `Discard` and the unsaved
 *  indicator stay honest. */
export const withEditorRatio = (
  editor: EditorState,
  photo: PhotoWithTags | undefined,
  ratio: PhotoRatio,
): EditorState =>
  // Guarded on the draft rather than on the Photo: the two are read together
  // and the draft is what the pick lands on, so a click during the load is a
  // no-op instead of an override against a Photo that has not arrived.
  editor.draft === undefined
    ? editor
    : { ...editor, ratio: photo?.ratio === ratio ? undefined : ratio }

/** One straighten step, clamped and rounded to the readout's precision. A
 *  result of zero is stored as null, because null is un-levelled rather than
 *  zero (CONTEXT.md, Crop). */
export const withEditorLevel = (editor: EditorState, direction: -1 | 1): EditorState => {
  if (editor.draft === undefined) return editor
  const next = clamp(
    roundTo((editor.draft.level ?? 0) + direction * LEVEL_STEP, 1),
    -LEVEL_LIMIT,
    LEVEL_LIMIT,
  )
  return { ...editor, draft: { ...editor.draft, level: next === 0 ? null : next } }
}

/** Mirror the frame horizontally. */
export const withEditorFlip = (editor: EditorState): EditorState =>
  editor.draft === undefined
    ? editor
    : { ...editor, draft: { ...editor.draft, cropFlipX: !editor.draft.cropFlipX } }

/** Start a pan. The frame's own box is captured here because the pointer move
 *  that follows has only its own position; the drag needs a denominator. */
export const withCropDragStart = (
  editor: EditorState,
  origin: { x: number; y: number; width: number; height: number },
): EditorState => {
  if (editor.draft === undefined) return editor
  return {
    ...editor,
    cropDrag: {
      ...origin,
      startX: editor.draft.cropX,
      startY: editor.draft.cropY,
    },
  }
}

/** Drag the photograph. The pan follows the pointer, so dragging right moves
 *  the visible window left: the stored pan is the source's position, and the
 *  pointer moves the source. Measured against the drag's origin, so a pointer
 *  that returns to where it started restores the crop instead of drifting. */
export const withEditorPan = (editor: EditorState, x: number, y: number): EditorState => {
  const drag = editor.cropDrag
  if (drag === undefined || editor.draft === undefined) return editor
  const dx = drag.width === 0 ? 0 : ((x - drag.x) / drag.width) * 100
  const dy = drag.height === 0 ? 0 : ((y - drag.y) / drag.height) * 100
  return {
    ...editor,
    draft: {
      ...editor.draft,
      cropX: roundTo(clamp(drag.startX - dx, -CROP_PAN_LIMIT, CROP_PAN_LIMIT), 3),
      cropY: roundTo(clamp(drag.startY - dy, -CROP_PAN_LIMIT, CROP_PAN_LIMIT), 3),
    },
  }
}

/** End a pan. The crop stays; only the in-flight state goes. */
export const withCropDragEnd = (editor: EditorState): EditorState =>
  editor.cropDrag === undefined ? editor : { ...editor, cropDrag: undefined }

/** Zoom the crop window. Scrolling up (a negative `deltaY`) zooms in. */
export const withEditorZoom = (editor: EditorState, deltaY: number): EditorState => {
  if (editor.draft === undefined) return editor
  const factor = deltaY < 0 ? CROP_ZOOM_STEP : 1 / CROP_ZOOM_STEP
  const scale = roundTo(clamp(editor.draft.cropScale * factor, CROP_SCALE_MIN, CROP_SCALE_MAX), 3)
  return { ...editor, draft: { ...editor.draft, cropScale: scale } }
}

// ---------------------------------------------------------------------------
// the Stage's geometry
// ---------------------------------------------------------------------------

/** The Mat's stored width is a percentage of the frame edge and the design's
 *  slider reads `4%`, so the design's own padding below is the 4% mat. */
export const MAT_WIDTH_PERCENT = 4

/** The design's Mat: 24px on the top, right and left and
 *  64px along the bottom — 24/24/64/24. That asymmetry *is* the
 *  `gallery` style the design names.
 *
 *  `even` and `square` are named by the design and not defined by it, and
 *  #32 owns their geometry, with the Swatches and the width slider beside it.
 *  Until it does, every style draws this one — and the only control that
 *  reaches a Mat today is its on/off, so the shortcut is unobservable rather
 *  than a value the Stage draws wrongly. */
const matPadding = (presentation: PhotoPresentation): string => {
  const scale = (presentation.borderWidth ?? MAT_WIDTH_PERCENT) / MAT_WIDTH_PERCENT
  const side = String(Math.round(24 * scale))
  const foot = String(Math.round(64 * scale))
  return `${side}px ${side}px ${foot}px ${side}px`
}

/** The Mat's padding, as an inline style: it is a number derived from a stored
 *  percentage, so there is no class for it. */
export const matPaddingStyle = (presentation: PhotoPresentation): Record<string, string> => ({
  padding: matPadding(presentation),
})

/** The Mat's fill, from the stored colour. `null` is a Photo whose mat was
 *  never coloured, and the design's own mat is white, so white is what it
 *  draws rather than a transparent frame. */
export const matColourClass = (presentation: PhotoPresentation): string => {
  switch (presentation.borderColour) {
    case 'paper':
      return 'bg-role-mat-paper'
    case 'ink':
      return 'bg-role-mat-ink'
    case 'white':
      return 'bg-role-mat-white'
    case null:
      return 'bg-role-mat-white'
  }
}

/** The frame's proportion: the authored Ratio when there is one, else the
 *  Photo's stored Ratio, else the source file's own, which is what "as shot"
 *  means (CONTEXT.md, Crop). */
export const frameAspect = (photo: PhotoWithTags, ratio?: PhotoRatio | null): string => {
  const chosen = ratio ?? photo.ratio ?? nearestRatio(photo.width, photo.height)
  return chosen === null ? `${String(photo.width)} / ${String(photo.height)}` : ratioAspect(chosen)
}

/** A `width / height` aspect string as a number, or `null` when it is not
 *  one. The Stage's geometry is all derived from this. */
const aspectValue = (aspect: string): number | null => {
  const parts = aspect.split('/').map((part) => Number(part.trim()))
  const width = parts[0]
  const height = parts[1]
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  return width / height
}

/** How much the frame must grow so a rotated crop still covers it. A level of
 *  zero is exactly `1`; a small angle needs a hair more, which is why an
 *  un-levelled Photo is not scaled at all. Derived from the frame's own
 *  proportion, because a 3:2 frame and a 2:3 frame need different amounts for
 *  the same angle. */
export const levelCoverScale = (level: number | null, aspect: string): number => {
  if (level === null || level === 0) return 1
  const ratio = aspectValue(aspect)
  if (ratio === null) return 1
  const radians = (Math.abs(level) * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return roundTo(cosine + sine * Math.max(1 / ratio, ratio), 4)
}

/** The Crop as the Stage applies it: a pan, a zoom, a mirror and a level, all
 *  relative to the source as shot.
 *
 *  `object-position` pans a `cover`ed frame and the transform zooms it, which
 *  is the whole of what a crop *is* once the numbers are stored. The level's
 *  own scale is folded in so the rotated frame cannot show the surface at its
 *  corners; the mirror is applied first, so the pan and the level read the same
 *  way whichever way the frame faces. */
export const cropStyle = (
  presentation: PhotoPresentation,
  aspect: string,
): Record<string, string> => {
  const level = presentation.level ?? 0
  const transforms: Array<string> = [
    `scale(${String(roundTo(presentation.cropScale * levelCoverScale(level, aspect), 4))})`,
  ]
  if (level !== 0) transforms.push(`rotate(${String(level)}deg)`)
  if (presentation.cropFlipX) transforms.push('scaleX(-1)')
  return {
    'object-position': `${String(50 + presentation.cropX)}% ${String(50 + presentation.cropY)}%`,
    transform: transforms.join(' '),
  }
}

/** The Mat's foot is the design's `gallery` geometry — 64px of foot against a
 *  24px side — as a multiple of the side. The width slider is a percentage of
 *  the frame edge, so the side is `borderWidth`% and the foot this much of it.
 *  The Stage spells the same ratio in pixels (`matPadding`); this is the one
 *  the composition's own pixels are drawn with. */
export const MAT_FOOT_MULTIPLE = 64 / 24

/** The composition a Blurhash is encoded from: the Crop, the level, the mirror
 *  and the Mat, in the terms `lib/blurhash` draws them. `undefined` while there
 *  is nothing to encode — no Photo, no draft, or a pan still in flight, which
 *  is deliberately not a committed composition: re-encoding on every pointer
 *  move would churn a canvas for a crop the operator has not released. */
export const compositionSpec = (
  photo: PhotoWithTags | undefined,
  editor: EditorState,
): CompositionSpec | undefined => {
  const draft = editor.draft
  if (photo === undefined || draft === undefined || editor.cropDrag !== undefined) return undefined
  const aspect = frameAspect(photo, effectiveRatio(photo, editor))
  const frameAspectValue = aspectValue(aspect) ?? photo.width / photo.height
  const widthPercent = draft.borderWidth ?? MAT_WIDTH_PERCENT
  const side = widthPercent / 100
  return {
    source: { width: photo.width, height: photo.height },
    frameAspect: frameAspectValue,
    panX: 50 + draft.cropX,
    panY: 50 + draft.cropY,
    scale: draft.cropScale * levelCoverScale(draft.level, aspect),
    rotation: draft.level ?? 0,
    flipX: draft.cropFlipX,
    ...(draft.borderEnabled
      ? { mat: { colour: draft.borderColour ?? 'white', side, foot: side * MAT_FOOT_MULTIPLE } }
      : {}),
  }
}

/** The composition's identity as a string, for the re-encoder's dependency
 *  comparison. The empty string means "nothing to encode". */
export const blurhashSignature = (
  photo: PhotoWithTags | undefined,
  editor: EditorState,
): string => {
  const spec = compositionSpec(photo, editor)
  return spec === undefined ? '' : JSON.stringify(spec)
}

/** The percentage the `FULL` Rendition saves against the original, or `null`
 *  when either byte count is unknown. Derived, never stored: the Export head
 *  prints it and nothing keeps it. `fullBytes` is `E6`'s (#35) to supply; until
 *  then there is no rendition to measure and no honest number to print. */
export const exportSavingPercent = (
  originalBytes: number | null | undefined,
  fullBytes: number | null | undefined,
): number | null => {
  if (
    originalBytes === null ||
    originalBytes === undefined ||
    originalBytes <= 0 ||
    fullBytes === null ||
    fullBytes === undefined
  ) {
    return null
  }
  return Math.round(((originalBytes - fullBytes) / originalBytes) * 100)
}

/** The Export head's readout: `−89%`, or `—` while there is no measurement.
 *  The minus is the typographic one the design draws, not a hyphen. */
export const exportSavingLabel = (
  originalBytes: number | null | undefined,
  fullBytes: number | null | undefined,
): string => {
  const percent = exportSavingPercent(originalBytes, fullBytes)
  return percent === null ? '—' : `−${String(percent)}%`
}

/** The frame's width, as the zoom asks for it. `FIT` is `undefined`: the frame
 *  is then sized by {@link fitFrameWidth} against the Stage's own viewport, and
 *  a percentage is that fraction of the source's own pixels, so `100%` is the
 *  file at its stored width and the Stage scrolls. */
export const zoomWidth = (photo: PhotoWithTags, zoom: string): string | undefined => {
  if (zoom === 'fit') return undefined
  const factor = Number(zoom) / 100
  return `${String(Math.round(photo.width * factor))}px`
}

/** The frame's width at `FIT`. The Stage cannot measure the element it is
 *  drawing, and an `aspect-ratio` box with no width collapses to nothing in a
 *  shrink-to-fit parent, so the fit is spelled against the viewport the way
 *  the Stage's own ceiling always was: the full width less the 360px
 *  Inspector, the Canvas's 32px of padding and the Mat's 24/24 sides, and the
 *  full height less the two 52px bars, the same Canvas padding and the Mat's
 *  24/64. The width is the smaller of what the width allows and what the
 *  height allows for this frame's own proportion, so a 2:3 frame fits the same
 *  box rather than overflowing it. */
export const fitFrameWidth = (aspect: string): string => {
  const ratio = roundTo(aspectValue(aspect) ?? 1, 4)
  return `min(calc(100vw - 29.5rem), calc((100dvh - 16rem) * ${String(ratio)}))`
}

// ---------------------------------------------------------------------------
// the Top Bar's copy
// ---------------------------------------------------------------------------

/** `NO. 024` — the Photo Number, zero-padded to the design's three digits
 *  (CONTEXT.md, Photo Number). A Photo the backfill has not numbered yet has
 *  none, and prints nothing rather than a zero that would be a number. */
export const photoNumberLabel = (photo: PhotoWithTags): string => {
  const { number } = photo
  if (number === undefined || number === null) return ''
  return `NO. ${String(number).padStart(3, '0')}`
}

/** The Status the chip prints. `scheduled` is a display label over a draft
 *  with a publish time, and nothing records a publish time, so a draft is a
 *  draft (CONTEXT.md, Status). */
export const statusVariantOf = (photo: PhotoWithTags): 'published' | 'draft' | 'failed' => {
  switch (photo.status) {
    case 'published':
      return 'published'
    case 'failed':
      return 'failed'
    case 'draft':
      return 'draft'
    case undefined:
      return 'draft'
  }
}

/** Where `← Library` goes: the route the Editor was opened from, printed by the
 *  same table the sidebar's links use. Named here so the link's `href`, the
 *  Escape handler and the leave guard cannot each invent their own answer. A
 *  return route that is not a list is the Library, which is what a cold load of
 *  the Editor's URL has. */
export const editorReturnUrl = (returnRoute: AppRoute): string =>
  returnRoute._tag === 'Library' ||
  returnRoute._tag === 'Drafts' ||
  returnRoute._tag === 'Scheduled'
    ? appRouteToUrl(returnRoute)
    : libraryUrl()
