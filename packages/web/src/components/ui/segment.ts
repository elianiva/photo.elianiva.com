/**
 * Segment — the Desk's single-select group (master `96138b5e94f43632`), and
 * the one stateful atom in the set. One option is 28px of height around 4/12 of
 * padding, `$typography.exif`, no box of its own and no corner radius; the
 * selected one fills `color.primary` and reads `color.on-primary`. The group
 * around them is a 1px box, `color.rule` for the Library's status filter and
 * `color.outline` everywhere else.
 *
 * It is a submodel rather than a view function because it owns the selection —
 * the issue's rule is that a stateful atom keeps its state in a `Model` folded
 * in with `Update.foldChild`, and a presentational atom holds none. The parent
 * folds `Picked` like any other child message: the child's own Model is written
 * back, and the parent acts on the pick (refetch, re-crop, set the status).
 *
 * The Editor's status `Seg` and the Library's ratio filter are the same
 * component with a different value set, so the options arrive through ViewInputs
 * rather than being declared here.
 */
import { Schema as S } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import * as Update from 'foldkit/update'

import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// model + message
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  /** The group's slot id — also its key in the parent's `segmentGroups`. */
  id: S.String,
  /** The value of the selected option. */
  selected: S.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  /** The operator clicked an option. The child takes the selection; the
   *  parent's fold decides what a pick means (fetch, save, discard). */
  Picked: { value: S.String },
})
export type Message = typeof Message.Type

export const init = (config: { id: string; selected: string }): Model => ({
  id: config.id,
  selected: config.selected,
})

export const update = (model: Model, message: Message): Update.Return<Model, Message> =>
  Message.match<Update.Return<Model, Message>>(message, {
    Picked: ({ value }) => ({ model: { ...model, selected: value } }),
  })

/** One group's Model for every group on a page, keyed by group id — a page
 *  with three single-selects carries one Model field, not three. */
export const Groups = S.Record(S.String, Model)
export type Groups = typeof Groups.Type

/** Initial state for a page's Segment groups. The first group listed is the
 *  one the page shows first; order is the caller's, not this module's. */
export const initGroups = (groups: ReadonlyArray<{ id: string; selected: string }>): Groups =>
  Object.fromEntries(groups.map((group) => [group.id, init(group)]))

/** The Model of one group, or `undefined` when the page has no such group —
 *  the shape `Update.foldChild`'s `read` wants. */
export const readGroup = (groups: Groups, id: string): Model | undefined => groups[id]

/** One group's Model written back into the set. */
export const writeGroup = (groups: Groups, id: string, next: Model): Groups => ({
  ...groups,
  [id]: next,
})

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

export interface SegmentOption<V extends string = string> {
  /** The value the parent acts on — a Ratio, a status, a mat style. */
  value: V
  /** What the option prints. A filter prints its count (`ALL 412`); a mat
   *  style prints its name. */
  label: string
}

/** The 1px box the options sit in. */
export const segmentFrameKeys = ['rule', 'outline'] as const
export type SegmentFrame = (typeof segmentFrameKeys)[number]

const frameClasses: Record<SegmentFrame, string> = {
  rule: 'border border-role-rule',
  outline: 'border border-role-outline',
}

export const segmentGroupClass =
  'inline-flex items-center border border-transparent [&>*]:h-7 [&>*]:shrink-0'

export const segmentOptionClass =
  'focus-visible:z-10 focus-visible:ring-role-focus/50 inline-flex items-center justify-center px-3 py-1 type-exif transition-colors duration-120 outline-none focus-visible:ring-[3px]'

const optionClasses = (isSelected: boolean): string =>
  cn(
    segmentOptionClass,
    isSelected
      ? 'bg-role-primary text-role-on-primary'
      : 'text-role-text-secondary hover:text-role-text-primary',
  )

export interface ViewInputs<V extends string = string> {
  options: ReadonlyArray<SegmentOption<V>>
  /** Names the group for assistive technology — `RATIO`, `FORMAT`, `Status`. */
  ariaLabel: string
  /** Which 1px box the group wears. Defaults to `outline`. */
  frame?: SegmentFrame
  /** A group with nothing to pick from yet — the Editor's Ratio segment while
   *  the Photo is still loading. Renders every option disabled rather than
   *  offering a pick that cannot be applied. */
  isDisabled?: boolean
  className?: string
  optionClass?: string
}

/** Everything one group draws, plus the pick it is showing. The submodel's
 *  `ViewInputs` carry no selection because the child Model owns it; the
 *  stateless group below takes it, for a caller that owns it instead (the
 *  Library's filters, whose answer the URL carries). */
export interface GroupInputs<V extends string = string> extends ViewInputs<V> {
  selected: V
  /** The group's slot id, when it has one. */
  id?: string
}

/** One group of buttons, with the selection passed in rather than owned.
 *  `view` delegates here, so the stateful and stateless callers draw the same
 *  thing. The value type is the option set's own, so a pick arrives typed as
 *  the union the caller declared rather than as a bare string. */
export const segmentGroup = <M, V extends string>(
  inputs: GroupInputs<V>,
  onPick: (value: V) => M,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Role('group'),
      h.AriaLabel(inputs.ariaLabel),
      h.Class(cn(segmentGroupClass, frameClasses[inputs.frame ?? 'outline'], inputs.className)),
      h.DataAttribute('slot', 'segment'),
      ...(inputs.id === undefined ? [] : [h.DataAttribute('id', inputs.id)]),
    ],
    inputs.options.map((option) =>
      h.button(
        [
          h.Key(option.value),
          h.Type('button'),
          h.AriaPressed(String(option.value === inputs.selected)),
          h.OnClick(onPick(option.value)),
          ...(inputs.isDisabled === true ? [h.Disabled(true)] : []),
          h.Class(
            cn(
              optionClasses(option.value === inputs.selected),
              inputs.isDisabled === true && 'cursor-not-allowed opacity-50',
              inputs.optionClass,
            ),
          ),
        ],
        [option.label],
      ),
    ),
  )

/** One single-select group that owns its own selection. */
export const view = defineView<Model, Message, ViewInputs>((model, inputs, h): Html =>
  segmentGroup(
    { ...inputs, selected: model.selected, id: model.id },
    (value) => Message.Picked({ value }),
    h,
  ),
)
