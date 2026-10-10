/**
 * Segment — the Desk's single-select group (master `96138b5e94f43632`), and
 * the one stateful atom in the set. It is the app's *only* choice group: every
 * "pick one of these" control is this component with a different value set, so
 * a row of them reads as one row rather than as a collection of idioms.
 *
 * One option is 28px of height around 4/12 of padding, `$typography.exif`, no
 * box of its own and no corner radius; the selected one fills `color.primary`
 * and reads `color.on-primary`. The group around them is a 1px `color.rule`
 * box — one box, for every group. There is no second frame to pick: a near-
 * black box beside a grey one in the same row was a mistake twice over, since
 * it read as two kinds of control and only one of them was chosen.
 *
 * `label` is the group's own label, printed to the left of the box, so
 * `[KICKER][box]` is one aligned unit rather than a label a caller hand-writes
 * beside the atom and has to keep on the baseline. An option may carry a glyph
 * instead of text (`icon`), which is how the Library's view toggle is a Segment
 * like every other choice rather than a pair of icon buttons.
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
import type { IconNode } from 'lucide'

import { icon } from '@/lib/icons'
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

export interface SegmentOption<V extends string | number = string> {
  /** The value the parent acts on — a Ratio, a status, a mat style. */
  value: V
  /** What the option prints. A filter prints its count (`ALL 412`); a mat
   *  style prints its name. */
  label: string
  /** The accessible name, where the printed text is not one. A glyph option has
   *  no text at all, so it needs one; a bare number needs the noun beside it
   *  (`4` is `4 columns`). Defaults to `label`, which is what a text option
   *  already reads as — so a plain option carries no `aria-label` at all. */
  ariaLabel?: string
  /** A glyph in place of the label — the Library's `List` / `LayoutGrid` pair.
   *  The accessible name still comes from `label`, so the two never disagree. */
  icon?: IconNode
}

/** The group's own label, beside the box. `type-label` in
 *  `color.text.secondary`, not `color.text.disabled`: it names a choice the
 *  operator can make, and `color.text.disabled` is 3.6:1 on the page's surface
 *  — under the 4.5:1 a 10px label needs. */
const groupLabelClass = 'type-label text-role-text-secondary'

/** The group row: the label and the box it names, on one baseline. */
const groupClass = 'inline-flex items-center gap-2'

/** The 1px `color.rule` box every group's options sit in. */
const boxClass = 'inline-flex items-stretch border border-role-rule'

export const segmentOptionClass =
  'focus-visible:z-10 focus-visible:ring-role-focus/50 inline-flex h-7 shrink-0 items-center justify-center px-3 type-exif transition-colors duration-120 outline-none focus-visible:ring-[3px]'

/** A glyph option is a square cell rather than a padded word, so a row of them
 *  is as tall as it is wide and lines up with the labelled groups beside it. */
const iconOptionClass = 'w-7 px-0'

/** An option's accessible name, or `undefined` when its printed text already is
 *  one — an `aria-label` that repeats the visible label is noise. */
const optionName = <V extends string | number>(option: SegmentOption<V>): string | undefined =>
  option.ariaLabel ?? (option.icon === undefined ? undefined : option.label)

/** The 14px slot the design gives a glyph inside a 28px option. */
const optionIconClass = 'size-3.5'

const optionClasses = <V extends string | number>(
  option: SegmentOption<V>,
  isSelected: boolean,
): string =>
  cn(
    segmentOptionClass,
    option.icon === undefined ? '' : iconOptionClass,
    isSelected
      ? 'bg-role-primary text-role-on-primary'
      : 'text-role-text-secondary hover:text-role-text-primary',
  )

export interface ViewInputs<V extends string | number = string> {
  options: ReadonlyArray<SegmentOption<V>>
  /** Names the group for assistive technology — `RATIO`, `FORMAT`, `Status`.
   *  When the group prints a `label`, this names it in words: `Ratio filter`
   *  for a `RATIO` label, so the accessible name contains the visible one. */
  ariaLabel: string
  /** The group's label, printed beside the box. Omitted where the group sits
   *  under a panel head that already names it — the Editor's six. */
  label?: string
  /** A group with nothing to pick from yet — the Editor's Ratio segment while
   *  the Photo is still loading. Renders every option disabled rather than
   *  offering a pick that cannot be applied. */
  isDisabled?: boolean
  /** Sized the options' box rather than the group row, so `w-78` and
   *  `flex w-full` mean what they meant when the group *was* the box. */
  className?: string
  optionClass?: string
}

/** Everything one group draws, plus the pick it is showing. The submodel's
 *  `ViewInputs` carry no selection because the child Model owns it; the
 *  stateless group below takes it, for a caller that owns it instead (the
 *  Library's filters, whose answer the URL carries). */
export interface GroupInputs<V extends string | number = string> extends ViewInputs<V> {
  selected: V
  /** The group's slot id, when it has one. */
  id?: string
}

/** One group of buttons, with the selection passed in rather than owned.
 *  `view` delegates here, so the stateful and stateless callers draw the same
 *  thing. The value type is the option set's own, so a pick arrives typed as
 *  the union the caller declared rather than as a bare string. */
export const segmentGroup = <M, V extends string | number>(
  inputs: GroupInputs<V>,
  onPick: (value: V) => M,
  h: HtmlBuilder<M>,
): Html =>
  h.div(
    [
      h.Role('group'),
      h.AriaLabel(inputs.ariaLabel),
      h.Class(groupClass),
      h.DataAttribute('slot', 'segment'),
      ...(inputs.id === undefined ? [] : [h.DataAttribute('id', inputs.id)]),
    ],
    [
      ...(inputs.label === undefined ? [] : [h.span([h.Class(groupLabelClass)], [inputs.label])]),
      h.div(
        [h.Class(cn(boxClass, inputs.className))],
        inputs.options.map((option) => {
          // Set where the printed text is not a name on its own: a glyph, or
          // a bare number with the noun left off.
          const name = optionName(option)
          return h.button(
            [
              h.Key(String(option.value)),
              h.Type('button'),
              h.AriaPressed(String(option.value === inputs.selected)),
              ...(name === undefined ? [] : [h.AriaLabel(name)]),
              h.OnClick(onPick(option.value)),
              ...(inputs.isDisabled === true ? [h.Disabled(true)] : []),
              h.Class(
                cn(
                  optionClasses(option, option.value === inputs.selected),
                  inputs.isDisabled === true && 'cursor-not-allowed opacity-50',
                  inputs.optionClass,
                ),
              ),
            ],
            option.icon === undefined ? [option.label] : [icon(h, option.icon, optionIconClass)],
          )
        }),
      ),
    ],
  )

/** One single-select group that owns its own selection. */
export const view = defineView<Model, Message, ViewInputs>((model, inputs, h): Html =>
  segmentGroup(
    { ...inputs, selected: model.selected, id: model.id },
    (value) => Message.Picked({ value }),
    h,
  ),
)
