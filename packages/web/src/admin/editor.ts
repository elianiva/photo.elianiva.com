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

import { nearestRatio, ratioAspect } from '@photo/shared'
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
 *  load. */
export const isEditorDirty = (editor: EditorState): boolean => {
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

/** The frame's proportion: the authored Ratio, or — for a Photo no Ratio has
 *  been snapped onto — the source file's own, which is what "as shot" means
 *  (CONTEXT.md, Crop). */
export const frameAspect = (photo: PhotoWithTags): string => {
  const ratio: PhotoRatio | null = photo.ratio ?? nearestRatio(photo.width, photo.height)
  return ratio === null ? `${String(photo.width)} / ${String(photo.height)}` : ratioAspect(ratio)
}

/** The Crop as the Stage applies it: a pan, a zoom and a level, all relative
 *  to the source as shot.
 *
 *  This is the shell's rendering, not the authoring model. `object-position`
 *  pans a `cover`ed frame and `scale` zooms it, which is the whole of what a
 *  crop *is* once the numbers are stored; #31 owns how the operator produces
 *  those numbers (the three transform buttons, dragging the frame) and the
 *  exact convention for the offsets. */
export const cropStyle = (presentation: PhotoPresentation): Record<string, string> => ({
  'object-position': `${String(50 + presentation.cropX)}% ${String(50 + presentation.cropY)}%`,
  transform: `scale(${String(presentation.cropScale)})${
    presentation.level === null || presentation.level === 0
      ? ''
      : ` rotate(${String(presentation.level)}deg)`
  }`,
})

/** The frame's width, as the zoom asks for it. `FIT` is `undefined`: the frame
 *  is then sized by its own `aspect-ratio` against the space the Stage leaves
 *  it, which is the only level that needs a size the view cannot know. A
 *  percentage is that fraction of the source's own pixels, so `100%` is the
 *  file at its stored width and the Stage scrolls. */
export const zoomWidth = (photo: PhotoWithTags, zoom: string): string | undefined => {
  if (zoom === 'fit') return undefined
  const factor = Number(zoom) / 100
  return `${String(Math.round(photo.width * factor))}px`
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
