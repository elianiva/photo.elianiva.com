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

import { PHOTO_RATIOS, nearestRatio, ratioAspect } from '@photo/shared'
import type { PhotoPresentation, PhotoRatio, PhotoWithTags } from '@photo/shared'

import * as Dialog from '@/components/ui/dialog'
import * as Segment from '@/components/ui/segment'

import { AppRoute, appRouteToUrl, libraryRoute, libraryUrl } from './route'
import type { EditorState } from './model'

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
export const editorSegments: ReadonlyArray<EditorSegmentGroup> = [ZOOM_SEGMENT, COMPARE_SEGMENT]

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
 *  misspelled field a compile error; `editor.test.ts` runs the list against a
 *  real Presentation both ways, so a field *added* to one and missed here is a
 *  red test rather than a value the dirty rule silently ignores. */
export const PRESENTATION_FIELDS: ReadonlyArray<keyof PhotoPresentation> = [
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
 *  the same `Update` commits — so it is checked first. */
export const isEditorDirty = (editor: EditorState): boolean => {
  if (editor.ratio !== undefined) return true
  const { snapshot, draft } = editor
  if (snapshot === undefined || draft === undefined) return false
  return PRESENTATION_FIELDS.some((field) => snapshot[field] !== draft[field])
}

/** Whether the Presentation itself has moved, as opposed to the Ratio override
 *  beside it. The save command needs the two apart: a Ratio-only save must not
 *  rewrite the crop, because a crop write is a Rendition regeneration (#35). */
export const isPresentationDirty = (editor: EditorState): boolean => {
  const { snapshot, draft } = editor
  if (snapshot === undefined || draft === undefined) return false
  return PRESENTATION_FIELDS.some((field) => snapshot[field] !== draft[field])
}

/** The Editor's copy of the Presentation, with the Mat's on/off replaced.
 *  Returns the state unchanged while there is no draft to change, so a toggle
 *  that arrives before the read answers is dropped rather than resurrecting a
 *  half-built Presentation the server never sent. */
export const withEditorMat = (editor: EditorState, enabled: boolean): EditorState =>
  editor.draft === undefined
    ? editor
    : { ...editor, draft: { ...editor.draft, borderEnabled: enabled } }

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

/** The design's Mat: `$spacing.xl` on the top, right and left and
 *  `$spacing.4xl` along the bottom — 24/24/64/24. That asymmetry *is* the
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
 *  Inspector, the Canvas's `--spacing.2xl` and the Mat's 24/24 sides, and the
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
  returnRoute._tag === 'Scheduled' ||
  returnRoute._tag === 'Uploads' ||
  returnRoute._tag === 'Trash'
    ? appRouteToUrl(returnRoute)
    : libraryUrl()
