/**
 * The Editor — `/admin/photos/<id>`, the frame the design draws as
 * `Desk — Editor` (`7209b08efe683213`). It is a document of its own rather
 * than a page inside the shell: the design gives it no sidebar, no Page Head
 * and no content gutter, and the theme scope is dark here and light on every
 * other route (`lib/theme.ts`, CONTEXT.md Theme scope). `view.ts` picks between
 * this and the shell, so nothing in the shell has to be hidden to take the
 * sidebar away.
 *
 * Four regions, in the design's order:
 *
 *   Top Bar     52px, 1px hairline under. `← Library`, a 1×20 divider,
 *               `NO. 024` in `$typography.exif`, the title in italic
 *               `$typography.body`, a Status chip; on the right the unsaved
 *               dot, the `UNSAVED CHANGES` kicker, `Discard` and `Update`.
 *   Stage       fills, and holds the Canvas, the Mat and the Photograph.
 *   Stage Bar   52px, 1px hairline over. The Zoom and Compare Segments.
 *   Inspector   360px, `color.surface.container`, 1px hairline on the left.
 *
 * What the Stage draws is the *draft*, so an unsaved change is visible before
 * it is saved; `editor.ts` owns that rule and the geometry behind it.
 *
 * Two regions carry unfinished work, and each says so here rather than
 * pretending otherwise:
 *
 *   - the Inspector's `HISTORY` tab is deferred (decision 8), so two tabs are
 *     drawn and not three — not even a disabled one, which would be a promise
 *     with nothing behind it;
 *   - the `EDIT` tab draws the Crop panel (#31) and the Mat's on/off. The Mat's
 *     colour, style and width beside the toggle are #32, and the export panel
 *     is #33. The `DETAILS` tab is finished (#34): the four `UpdatePhoto`
 *     Fields, the Status group and the `RATIO` override, plus the one line no
 *     control may change.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'
import type { PhotoPresentation, PhotoRatio, PhotoWithTags } from '@photo/shared'
import { PHOTO_RATIOS } from '@photo/shared'
import { ArrowLeft, FlipHorizontal, RotateCcw, RotateCw } from 'lucide'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'
import * as IconButton from '@/components/ui/icon-button'
import * as Input from '@/components/ui/input'
import * as NavLink from '@/components/ui/nav-link'
import * as Segment from '@/components/ui/segment'
import * as Select from '@/components/ui/select'
import * as Status from '@/components/ui/status'
import * as Textarea from '@/components/ui/textarea'
import * as ToggleRow from '@/components/ui/toggle-row'

import { icon } from '@/lib/icons'
import { originalUrl } from '@/lib/image'
import { scopeTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

import {
  COMPARE_SEGMENT,
  CROP_RATIO_SEGMENT,
  EDITOR_STATUS_SEGMENT,
  ZOOM_SEGMENT,
  cropRatioLabel,
  cropStyle,
  editorReturnUrl,
  editorSegmentSelected,
  effectiveRatio,
  fitFrameWidth,
  frameAspect,
  isEditorDirty,
  isPhotoRatio,
  levelLabel,
  matColourClass,
  matPaddingStyle,
  photoNumberLabel,
  ratioOptionLabel,
  statusVariantOf,
  zoomWidth,
  type EditorCompare,
  type EditorSegmentGroup,
  type EditorZoom,
} from '../editor'
import { Message as M } from '../model'
import type { EditorTab, Model, Msg } from '../model'
import { documentTitle } from './page-head'
import { toastStack } from './overlays'
import type { Child } from './shared'

// ---------------------------------------------------------------------------
// Top Bar
// ---------------------------------------------------------------------------

/** `← Library` returns to the route the Editor was opened from, so a Photo
 *  reached from Drafts goes back to Drafts rather than to the Library. It is an
 *  anchor carrying that URL, not a `history.back()`: the runtime intercepts it
 *  and so does every other affordance a link has. */
const backLink = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.a(
    [
      h.Href(editorReturnUrl(model.editor.returnRoute)),
      h.DataAttribute('slot', 'editor-back'),
      h.Class(
        'focus-visible:ring-role-focus/50 inline-flex h-9 items-center gap-(--spacing-sm) px-(--spacing-lg) type-ui text-role-text-primary transition-colors duration-(--motion-duration-fast) hover:bg-role-surface-hover focus-visible:ring-[3px] focus-visible:outline-none',
      ),
    ],
    [icon(h, ArrowLeft, 'size-4 shrink-0'), 'Library'],
  )

/** The left group: the link, the 1×20 divider, the Photo Number in
 *  `$typography.exif` on `color.text.disabled`, the title in italic
 *  `$typography.body`, then the Status chip. */
const topBarLeft = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const photo = model.photo
  return h.div(
    [h.Class('flex min-w-0 items-center gap-(--spacing-lg)')],
    [
      backLink(model, h),
      h.span([h.AriaHidden(true), h.Class('h-5 w-px bg-role-hairline')]),
      h.span(
        [h.Class('type-exif shrink-0 text-role-text-disabled')],
        [photo === undefined ? '' : photoNumberLabel(photo)],
      ),
      // The Editor's one heading: the Title in italic `$typography.body` is
      // the only thing on screen that names the document.
      h.h1(
        [h.Class('type-body truncate italic text-role-text-primary')],
        [photo === undefined ? '' : photo.title],
      ),
      ...(photo === undefined ? [] : [Status.status({ variant: statusVariantOf(photo) }, h)]),
    ],
  )
}

/** The right group. The unsaved dot and the kicker are drawn only while the
 *  draft differs from the snapshot, and the two buttons are disabled when it
 *  does not: a `Discard` with nothing to discard and an `Update` with nothing
 *  to send are controls that lie about what the page can do. The design holds
 *  the group's width with an invisible 1×20 rule, which a group that is not
 *  drawn at all does not need. */
const topBarRight = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const dirty = isEditorDirty(model.editor)
  return h.div(
    [h.Class('flex items-center gap-(--spacing-sm)')],
    [
      ...(dirty
        ? [
            h.span([
              h.AriaHidden(true),
              h.DataAttribute('slot', 'unsaved-dot'),
              h.Class('size-1.5 shrink-0 rounded-full bg-role-accent'),
            ]),
            h.span(
              [
                h.DataAttribute('slot', 'unsaved-kicker'),
                h.Class('type-kicker text-role-text-secondary'),
              ],
              ['UNSAVED CHANGES'],
            ),
          ]
        : []),
      Button.button(
        { onClick: M.DiscardEditor(), variant: 'ghost', isDisabled: !dirty },
        'Discard',
        h,
      ),
      Button.button(
        {
          onClick: M.SubmitEditorUpdate(),
          variant: 'default',
          isDisabled: !dirty || model.editor.saving,
        },
        model.editor.saving ? 'Updating…' : 'Update',
        h,
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// Stage — Canvas, Mat, Photograph
// ---------------------------------------------------------------------------

/** The crop window. `object-cover` with a pan, a zoom and a level is what a
 *  stored Crop *is* once it is data (`editor.ts`); #31 owns how the operator
 *  produces those numbers. */
const frame = (
  photo: PhotoWithTags,
  presentation: PhotoPresentation | undefined,
  aspect: string,
  width: string,
  isOriginal: boolean,
  h: HtmlBuilder<Msg>,
): Child =>
  h.div(
    [
      h.DataAttribute('slot', isOriginal ? 'photograph-original' : 'photograph'),
      // The gesture listeners find the authored frame by this, not by the slot:
      // the slot names what the element is, and this names what the operator
      // can do to it. Dragging the `ORIGINAL` frame of a Split is not a crop.
      ...(isOriginal ? [] : [h.DataAttribute('crop-frame', 'true')]),
      h.Style({
        'aspect-ratio': aspect,
        width,
      }),
      h.Class(
        cn(
          'relative shrink-0 overflow-hidden bg-role-surface-container',
          isOriginal ? undefined : 'cursor-grab touch-none select-none active:cursor-grabbing',
        ),
      ),
    ],
    [
      // The image fills the crop window, so it carries its own box rather than
      // being targeted by a child selector: the classes are the ones Tailwind
      // emits, and a window with no image in it shows the surface underneath.
      h.img([
        h.DataAttribute('slot', 'photograph-image'),
        // The crop's pan, zoom, mirror and level are this element's style, so
        // it carries its own handle: the frame is the window, the image is what
        // moves inside it.
        ...(isOriginal ? [] : [h.DataAttribute('crop-image', 'true')]),
        h.Src(originalUrl(photo)),
        h.Alt(photo.title),
        h.Attribute('decoding', 'async'),
        h.Class('absolute inset-0 size-full object-cover'),
        // The uncropped original, so `ORIGINAL` is the file as the camera made
        // it rather than a second reading of the draft.
        ...(isOriginal || presentation === undefined
          ? []
          : [h.Style(cropStyle(presentation, aspect))]),
      ]),
    ],
  )

/** The Mat, when the draft has it on. Its shadow is the design's own —
 *  `color.shadow` at half, offset 12, blur 40 — spelled as a `color-mix` of
 *  the role token so the Desk names no colour literal. */
const mat = (
  photo: PhotoWithTags,
  presentation: PhotoPresentation,
  aspect: string,
  width: string,
  h: HtmlBuilder<Msg>,
): Child =>
  h.div(
    [
      h.DataAttribute('slot', 'mat'),
      h.Style(matPaddingStyle(presentation)),
      h.Class(
        cn(
          'shrink-0 shadow-[0_12px_40px_0_color-mix(in_srgb,var(--color-role-shadow)_50%,transparent)]',
          matColourClass(presentation),
        ),
      ),
    ],
    [frame(photo, presentation, aspect, width, false, h)],
  )

/** The design's `ORIGINAL · SPLIT · EXPORT` three ways of looking at one
 *  Photo, all three drawn rather than only the default: a Compare mode that
 *  shows nothing is a button that does nothing. */
const stageImage = (
  photo: PhotoWithTags,
  draft: PhotoPresentation,
  compare: EditorCompare,
  zoom: EditorZoom,
  ratio: PhotoRatio | null,
  h: HtmlBuilder<Msg>,
): Child => {
  const authored = frameAspect(photo, ratio)
  const asShot = `${String(photo.width)} / ${String(photo.height)}`
  const explicit = zoomWidth(photo, zoom)
  if (compare === 'original')
    return frame(photo, undefined, asShot, explicit ?? fitFrameWidth(asShot), true, h)
  const authoredWidth = explicit ?? fitFrameWidth(authored)
  const exported = draft.borderEnabled
    ? mat(photo, draft, authored, authoredWidth, h)
    : frame(photo, draft, authored, authoredWidth, false, h)
  if (compare !== 'split') return exported
  return h.div(
    [h.DataAttribute('slot', 'compare-split'), h.Class('flex shrink-0 items-stretch')],
    [
      frame(photo, undefined, asShot, explicit ?? fitFrameWidth(asShot), true, h),
      h.span([h.AriaHidden(true), h.Class('w-px shrink-0 self-stretch bg-role-hairline')], []),
      exported,
    ],
  )
}

/** The loading and error states. The Top Bar stays drawn through both: it is
 *  the Editor's own frame, and a page that loses its frame while it fetches
 *  reads as a different page. */
const stageState = (model: Model, h: HtmlBuilder<Msg>): Child =>
  model.photoStatus === 'error'
    ? h.div(
        [
          h.DataAttribute('slot', 'editor-error'),
          h.Class(
            'border border-role-accent bg-role-error-container p-(--spacing-lg) type-ui text-role-error',
          ),
        ],
        [
          h.p([], ['That Photo could not be loaded.']),
          Button.button(
            { onClick: M.RetryFetchPhoto(), variant: 'secondary', className: 'mt-3' },
            'Retry',
            h,
          ),
        ],
      )
    : h.p(
        [h.DataAttribute('slot', 'editor-loading'), h.Class('type-exif text-role-text-secondary')],
        ['Loading photo…'],
      )

/** One Stage Bar group, through the same `Segment` atom the atoms sheet draws.
 *  The state is in the shared `segmentGroups` record, so a pick is the atom's
 *  own and reaches the parent as `GotSegmentMessage`. */
const editorSegment = (model: Model, group: EditorSegmentGroup, h: HtmlBuilder<Msg>): Child => {
  const { id, selected, ...viewInputs } = group
  return h.submodel({
    slotId: id,
    model: Segment.readGroup(model.segmentGroups, id) ?? Segment.init({ id, selected }),
    view: Segment.view,
    viewInputs,
    toParentMessage: (message) => M.GotSegmentMessage({ groupId: id, message }),
  })
}

/** Canvas → Mat → Photograph, centred, `--spacing.2xl` of padding. */
const stage = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const photo = model.photo
  const draft = model.editor.draft
  const ready = photo !== undefined && model.photoStatus === 'ready' && draft !== undefined
  const zoom = editorSegmentSelected(model.segmentGroups, ZOOM_SEGMENT)
  const compare = editorSegmentSelected(model.segmentGroups, COMPARE_SEGMENT)
  return h.div(
    [h.DataAttribute('slot', 'editor-stage'), h.Class('flex min-h-0 min-w-0 flex-1 flex-col')],
    [
      h.div(
        [
          h.DataAttribute('slot', 'editor-canvas'),
          h.Class(
            'flex min-h-0 flex-1 items-center justify-center overflow-auto p-(--spacing-2xl)',
          ),
        ],
        [
          ...(ready && photo !== undefined && draft !== undefined
            ? [stageImage(photo, draft, compare, zoom, effectiveRatio(photo, model.editor), h)]
            : [stageState(model, h)]),
        ],
      ),
      h.div(
        [
          h.DataAttribute('slot', 'editor-stage-bar'),
          h.Class(
            'flex h-13 shrink-0 items-center gap-(--spacing-lg) border-t border-role-hairline px-(--spacing-xl) py-(--spacing-md)',
          ),
        ],
        [editorSegment(model, ZOOM_SEGMENT, h), editorSegment(model, COMPARE_SEGMENT, h)],
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/** A labelled panel in the Inspector: a `$typography.kicker` head over the
 *  design's own section rule. The head's right half is a slot because the Crop
 *  panel prints `<ratio> · AS SHOT` there and the other panels print nothing. */
const panelHead = (kicker: string, right: Child | undefined, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Class('flex items-center justify-between gap-(--spacing-sm)')],
    [
      h.h2([h.Class('type-kicker text-role-text-primary')], [kicker]),
      ...(right === undefined ? [] : [right]),
    ],
  )

const panel = (kicker: string, h: HtmlBuilder<Msg>, ...children: ReadonlyArray<Child>): Child =>
  h.section(
    [h.Class('flex flex-col gap-(--spacing-md) border-b border-role-hairline pb-(--spacing-lg)')],
    [panelHead(kicker, undefined, h), ...children],
  )

/** One Inspector tab.
 *
 *  The design draws the two as `Nav Link`s and this wears that atom's class and
 *  states. They are buttons rather than links because a tab is not a
 *  destination: the Editor has one URL, and a link to the URL it is already on
 *  looks like it navigates and does not. The roles are the standard ones, so
 *  assistive technology is given a tablist rather than two links. */
const tab = (value: EditorTab, label: string, active: EditorTab, h: HtmlBuilder<Msg>): Child =>
  h.button(
    [
      h.Type('button'),
      h.Role('tab'),
      h.AriaSelected(value === active),
      h.DataAttribute('slot', 'nav-link'),
      h.DataAttribute('state', value === active ? 'active' : 'default'),
      h.DataAttribute('tab', value),
      h.OnClick(M.SwitchedEditorTab({ tab: value })),
      h.Class(
        cn(
          NavLink.navLinkBaseClass,
          NavLink.navLinkStateClasses[value === active ? 'active' : 'default'],
        ),
      ),
    ],
    [label],
  )

/** The `EDIT` tab's Crop panel: the design's head, the six-Ratio `Segment` and
 *  the Transform row. The panel is the whole of the crop's authoring surface
 *  except the two Stage gestures — panning the photograph and the modified
 *  wheel — which the design gives no control because the photograph itself is
 *  the control.
 *
 *  The Ratio is a Photo column and the transform facts are Presentation fields,
 *  but the operator authors them in one place, so they are one panel and one
 *  `Update`. */
const cropPanel = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const draft = model.editor.draft
  const ratio = effectiveRatio(model.photo, model.editor)
  const disabled = draft === undefined
  const label = cropRatioLabel(model.photo, model.editor)
  return h.section(
    [h.Class('flex flex-col gap-(--spacing-md) border-b border-role-hairline pb-(--spacing-lg)')],
    [
      panelHead(
        'CROP',
        h.span(
          [h.DataAttribute('slot', 'crop-ratio'), h.Class('type-exif text-role-text-disabled')],
          [label],
        ),
        h,
      ),
      h.submodel({
        slotId: CROP_RATIO_SEGMENT.id,
        model: Segment.init({
          id: CROP_RATIO_SEGMENT.id,
          selected: ratio ?? PHOTO_RATIOS[0],
        }),
        view: Segment.view,
        viewInputs: {
          options: CROP_RATIO_SEGMENT.options,
          ariaLabel: CROP_RATIO_SEGMENT.ariaLabel,
          isDisabled: disabled,
          className: 'flex w-full',
          optionClass: 'flex-1',
        },
        toParentMessage: (message) => M.GotCropRatioMessage({ message }),
      }),
      h.div(
        [h.Class('flex items-center justify-between gap-(--spacing-sm)')],
        [
          h.div(
            [h.Class('flex items-center gap-(--spacing-xs)')],
            [
              IconButton.iconButton(
                {
                  kind: 'outline',
                  ariaLabel: 'Straighten counter-clockwise',
                  isDisabled: disabled,
                  onClick: M.SteppedEditorLevel({ direction: -1 }),
                },
                RotateCcw,
                h,
              ),
              IconButton.iconButton(
                {
                  kind: 'outline',
                  ariaLabel: 'Straighten clockwise',
                  isDisabled: disabled,
                  onClick: M.SteppedEditorLevel({ direction: 1 }),
                },
                RotateCw,
                h,
              ),
              IconButton.iconButton(
                {
                  kind: 'outline',
                  ariaLabel: 'Flip horizontally',
                  isDisabled: disabled,
                  isPressed: draft?.cropFlipX ?? false,
                  onClick: M.ToggledEditorFlip(),
                },
                FlipHorizontal,
                h,
              ),
            ],
          ),
          h.span(
            [h.Class('type-exif text-role-text-secondary')],
            [draft === undefined ? '' : levelLabel(draft)],
          ),
        ],
      ),
    ],
  )
}

/** The `EDIT` tab. The Crop panel and the Mat's on/off are the shell's: the Mat
 *  is the one control that changes what the Stage draws out of the stored
 *  Presentation, so it is the one the save bar needs to be real. Its three
 *  siblings — the Swatches, the `Mat Style` segment and the width slider — are
 *  #32's, and the panel's frame and head are the design's. */
const editTab = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [h.Role('tabpanel'), h.AriaLabel('EDIT'), h.Class('flex flex-col gap-(--spacing-xl)')],
    [
      cropPanel(model, h),
      panel(
        'BORDER',
        h,
        h.div(
          [h.Class('flex items-center justify-between gap-(--spacing-sm)')],
          [
            h.span([h.Class('type-ui text-role-text-primary')], ['Mat']),
            ToggleRow.toggleRow(
              {
                id: 'editor-mat',
                label: 'Mat',
                isChecked: model.editor.draft?.borderEnabled ?? false,
                isDisabled: model.editor.draft === undefined,
                onToggle: (isChecked) => M.ToggledEditorMat({ enabled: isChecked }),
              },
              h,
            ),
          ],
        ),
      ),
    ],
  )

/** The design's `Field` box is a recipe — 8px of padding above and below the
 *  value's own line box — and the shared `Input` atom pins its box at `h-9`,
 *  which renders 3.2px shorter than the master's 55.21px. The `DETAILS` tab is
 *  the design's Field, so its single-line controls take the recipe (`h-auto`,
 *  and the atom's own padding does the rest) rather than the pin. */
const FIELD_BOX = 'h-auto'

/** The `DETAILS` tab: the Photo's own record. `TITLE`, `PLACE`, `TAKEN` and
 *  `SLUG` are `UpdatePhoto` fields written on the Top Bar's `Update`; the
 *  Status group is `SetPhotoStatus`; the `RATIO` Select writes the same
 *  `EditorState.ratio` override the Crop section's Segment does. The design's
 *  `SERIES` Select that followed `PLACE` is gone (decision 5 — no Series
 *  entity), and `PLACE` is `metadata.location`, so the two rows sit directly
 *  beside each other with no empty slot between them.
 *
 *  The panel draws no footer: the Top Bar already owns the save action, and a
 *  second `Discard` / `Update` pair below the record would be the same two
 *  actions offered twice (#30). */
const detailsTab = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const photo = model.photo
  const draft = model.editor.detailsDraft
  const ready = photo !== undefined && model.photoStatus === 'ready' && draft !== undefined
  // A form over a Photo that has not loaded yet is drawn disabled over empty
  // values rather than blinking out and back.
  const details = draft ?? { title: '', slug: '', location: '', takenAt: '' }
  const number = photo === undefined ? 'NO. —' : photoNumberLabel(photo) || 'NO. —'
  return h.div(
    [h.Role('tabpanel'), h.AriaLabel('DETAILS'), h.Class('flex flex-col gap-(--spacing-xl)')],
    [
      panel(
        'RECORD',
        h,
        // TITLE is the one Field that grows with its value. The design's TITLE
        // Field is 78.41px against the master's 55.21px, and the extra 23.2px
        // is one more line of `$typography.body` (16px at 1.45 leading) — the
        // value wraps to two lines. There is no helper row and no `rows` prop
        // in the master (`cb46079a5eae06e4`), so a `Textarea` — the same
        // underlined box on a field that grows — is what draws the design's
        // height, and `min-h-9` keeps a short title at the master's box.
        Textarea.textarea(
          {
            id: 'editor-title',
            label: 'TITLE',
            value: details.title,
            isDisabled: !ready,
            className: 'min-h-9',
            onInput: (value) => M.SetEditorTitle({ value }),
          },
          h,
        ),
        Input.input(
          {
            id: 'editor-place',
            label: 'PLACE',
            value: details.location,
            isDisabled: !ready,
            className: FIELD_BOX,
            onInput: (value) => M.SetEditorPlace({ value }),
          },
          h,
        ),
        Input.input(
          {
            id: 'editor-taken',
            label: 'TAKEN',
            // `takenAt` is a day (`YYYY-MM-DD`); a native date field edits
            // exactly that column and draws the operator's own format over it.
            type: 'date',
            value: details.takenAt,
            isDisabled: !ready,
            className: FIELD_BOX,
            onInput: (value) => M.SetEditorTakenAt({ value }),
          },
          h,
        ),
        // The Status group is the same `Segment` atom as the Stage Bar's
        // groups, drawn as equal thirds of the 312px column.
        editorSegment(
          model,
          {
            ...EDITOR_STATUS_SEGMENT,
            className: 'w-full',
            optionClass: 'flex-1',
            isDisabled: !ready,
          },
          h,
        ),
        Select.select(
          {
            id: 'editor-ratio',
            label: 'RATIO',
            // The override if the Crop section (or this Select) set one, else
            // the stored column, else the frame's nearest supported Ratio. A
            // stored Ratio always wins over a derived one (CONTEXT.md, Ratio).
            value: effectiveRatio(photo, model.editor) ?? '3:2',
            isDisabled: !ready,
            options: PHOTO_RATIOS.map((ratio) => ({
              value: ratio,
              label: ratioOptionLabel(ratio),
            })),
            onChange: (value) => M.SetEditorRatio({ ratio: isPhotoRatio(value) ? value : '3:2' }),
          },
          h,
        ),
        // Read-only. The Photo Number is assigned at upload, is unique across
        // the site and is never reused — not by a deleted Photo and not by a
        // purged one (CONTEXT.md, Photo Number) — so no control may edit it.
        h.p(
          [h.Class('type-exif-sm text-role-text-disabled')],
          [`${number} · SET AT UPLOAD · NEVER REUSED`],
        ),
        Input.input(
          {
            id: 'editor-slug',
            label: 'SLUG',
            value: details.slug,
            isDisabled: !ready,
            className: FIELD_BOX,
            onInput: (value) => M.SetEditorSlug({ value }),
          },
          h,
        ),
      ),
    ],
  )
}

/** The 360px Inspector: `color.surface.container` with a 1px hairline on the
 *  left, the tab strip over the tab body. */
const inspector = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.div(
    [
      h.DataAttribute('slot', 'editor-inspector'),
      h.Class(
        'flex w-90 shrink-0 flex-col overflow-y-auto border-l border-role-hairline bg-role-surface-container',
      ),
    ],
    [
      h.div(
        [
          h.Role('tablist'),
          h.AriaLabel('Editor sections'),
          h.Class(
            'flex items-center gap-(--spacing-xl) border-b border-role-hairline px-(--spacing-xl) py-(--spacing-md)',
          ),
        ],
        [tab('edit', 'EDIT', model.editor.tab, h), tab('details', 'DETAILS', model.editor.tab, h)],
      ),
      h.div(
        [h.Class('flex flex-col gap-(--spacing-xl) p-(--spacing-xl)')],
        [model.editor.tab === 'edit' ? editTab(model, h) : detailsTab(model, h)],
      ),
    ],
  )

// ---------------------------------------------------------------------------
// the leave guard
// ---------------------------------------------------------------------------

/** The Editor's leave guard, raised when the operator tries to leave with
 *  unsaved changes. It is the app's own `Dialog` atom in a slot of its own
 *  rather than the destructive-action confirm, because that one's copy and its
 *  `Yes, delete` button are about a delete, and neither is true here. */
const leaveDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-editor-leave',
    model: model.editor.leaveDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('flex flex-col gap-(--spacing-lg) p-4')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-(--spacing-sm)')],
                [
                  Dialog.title({ attributes: render.title }, ['Unsaved changes'], innerH),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              Dialog.description(
                { attributes: render.description },
                ['This Photo has changes that have not been saved. Leaving now discards them.'],
                innerH,
              ),
              h.div(
                [h.Class('flex justify-end gap-(--spacing-sm)')],
                [
                  Button.button(
                    {
                      onClick: M.GotEditorLeaveMessage({
                        message: Dialog.Message.RequestedClose(),
                      }),
                      variant: 'secondary',
                    },
                    'Keep editing',
                    innerH,
                  ),
                  Button.button(
                    { onClick: M.ConfirmedLeaveEditor(), variant: 'destructive' },
                    'Discard and leave',
                    innerH,
                  ),
                ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotEditorLeaveMessage({ message }),
  })

// ---------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------

/** The Editor, as a whole document. `view.ts` hands this to the runtime
 *  instead of the shell, so no part of the shell has to be conditionally
 *  hidden to take the sidebar away. */
export const editorDocument = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: documentTitle(model),
  body: h.div(
    [
      scopeTheme('dark', h),
      h.DataAttribute('slot', 'editor'),
      h.Class('flex h-dvh flex-col overflow-hidden bg-role-surface text-role-text-primary'),
    ],
    [
      h.header(
        [
          h.DataAttribute('slot', 'editor-top-bar'),
          h.Class(
            'flex h-13 shrink-0 items-center justify-between gap-(--spacing-lg) border-b border-role-hairline px-(--spacing-xl) py-(--spacing-sm)',
          ),
        ],
        [topBarLeft(model, h), topBarRight(model, h)],
      ),
      h.div([h.Class('flex min-h-0 flex-1')], [stage(model, h), inspector(model, h)]),
      leaveDialog(model, h),
      toastStack(model, h),
    ],
  ),
})
