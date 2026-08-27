/**
 * TagManager — the Admin's tag bar as a self-contained submodel component:
 * a chip row with per-tag photo counts (click to filter, click again to
 * clear), a hover-revealed delete button per chip, an inline create input,
 * and the result line.
 *
 * The component owns only its create-input text. Everything domain-shaped —
 * tags, counts, the active filter slug, the result summary — arrives through
 * view inputs on every render, so it stays a dumb-ish leaf the parent can
 * feed from its own Model. Operator intents surface as plain Messages:
 * `ToggledFilter` / `RequestedDelete` / `SubmitCreate` are acted on by the
 * parent's GotTagManagerMessage fold in update.ts.
 */

import { Schema as S } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { defineView } from 'foldkit/submodel'
import { evo } from 'foldkit/struct'

import { Trash2, Plus } from 'lucide'
import type { Tag } from '@photo/shared'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type Child = Html | string

// ---------------------------------------------------------------------------
// model + message
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  id: S.String,
  /** Draft label typed into the inline create input. */
  inputValue: S.String,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
  SetInput: { value: S.String },
  SubmitCreate: {},
  /** The operator clicked a chip: the parent re-runs its filter toggle. */
  ToggledFilter: { slug: S.String },
  /** The operator clicked a chip's delete button. */
  RequestedDelete: { id: S.String, label: S.String },
})
export type Message = typeof Message.Type

export const init = (config: { id: string }): Model => ({ id: config.id, inputValue: '' })

/** Intents ride to the parent via GotTagManagerMessage — the child itself
 *  only manages input text, so it never issues commands. */
export const update = (model: Model, message: Message): readonly [Model, ReadonlyArray<never>] =>
  Message.match<readonly [Model, ReadonlyArray<never>]>(message, {
    SetInput: ({ value }) => [evo(model, { inputValue: () => value }), []],
    SubmitCreate: () => [{ ...model, inputValue: '' }, []],
    ToggledFilter: () => [model, []],
    RequestedDelete: () => [model, []],
  })

// ---------------------------------------------------------------------------
// view
// ---------------------------------------------------------------------------

export interface ViewInputs {
  tags: ReadonlyArray<Tag>
  /** Slug of the currently-applied filter, if any. */
  activeSlug?: string
  /** Photos per tag id. Return undefined to hide the count badge (counts
   *  describe the loaded result set, so they are meaningless while
   *  filtered — every chip would repeat the same number). */
  countFor?: (tag: Tag) => number | undefined
  /** Summary line under the chips ("12 photos · filtered by "kyoto""). */
  resultText: string
}

const chipClass = (isActive: boolean): string =>
  cn(
    'group inline-flex max-w-full items-center overflow-hidden rounded-full border transition-colors',
    isActive
      ? 'border-stone-900 bg-stone-900 text-white shadow-sm'
      : 'border-stone-200 bg-white text-stone-700 hover:border-stone-300 hover:bg-stone-50',
  )

const countBadge = (
  count: number | undefined,
  isActive: boolean,
  h: HtmlBuilder<Message>,
): Child =>
  count === undefined
    ? ''
    : h.span(
        [
          h.Class(
            cn(
              'rounded-full px-1.5 py-px text-[10px] leading-4 tabular-nums',
              isActive ? 'bg-white/20 text-white/80' : 'bg-stone-100 text-stone-500',
            ),
          ),
        ],
        [String(count)],
      )

const deleteButton = (tag: Tag, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.OnClick(Message.RequestedDelete({ id: tag.id, label: tag.label })),
      h.AriaLabel(`Delete tag ${tag.label}`),
      h.Title(`Delete tag “${tag.label}”`),
      h.Class(
        cn(
          'mr-1.5 shrink-0 rounded-full p-0.5 transition-opacity',
          'opacity-0 group-hover:opacity-50 hover:!opacity-100 focus-visible:opacity-100',
          'hover:text-red-600',
        ),
      ),
    ],
    [icon(h, Trash2, 'size-3')],
  )

export const view = defineView<Model, Message, ViewInputs>((model, inputs, h): Html =>
  h.section(
    [h.DataAttribute('slot', 'tag-manager'), h.Class('mt-8')],
    [
      h.div(
        [h.Class('flex items-center justify-between gap-4')],
        [
          h.div(
            [h.Class('flex items-baseline gap-2')],
            [
              h.h2(
                [h.Class('text-xs font-medium uppercase tracking-widest text-stone-400')],
                ['Tags'],
              ),
              h.span(
                [h.Class('text-xs tabular-nums text-stone-400')],
                [String(inputs.tags.length)],
              ),
            ],
          ),
          // Inline create: typing filters nothing, Enter or the + button submits.
          h.form(
            [h.OnSubmit(Message.SubmitCreate()), h.Class('relative')],
            [
              h.input([
                h.Value(model.inputValue),
                h.OnInput((value) => Message.SetInput({ value })),
                h.Placeholder('New tag…'),
                h.AriaLabel('New tag name'),
                h.Class(
                  'h-8 w-44 rounded-full border border-stone-200 bg-white pr-8 pl-3.5 text-xs shadow-xs placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-200',
                ),
              ]),
              h.button(
                [
                  h.Type('submit'),
                  h.AriaLabel('Create tag'),
                  h.Title(
                    `Create tag${model.inputValue.trim() === '' ? '' : ` “${model.inputValue.trim()}”`}`,
                  ),
                  h.Class(
                    cn(
                      'absolute top-1/2 right-1 -translate-y-1/2 rounded-full p-1 text-stone-400 transition-colors hover:text-stone-900 focus-visible:outline-none',
                      model.inputValue.trim() === '' && 'opacity-40',
                    ),
                  ),
                ],
                [icon(h, Plus, 'size-3.5')],
              ),
            ],
          ),
        ],
      ),
      ...(inputs.tags.length === 0
        ? [
            h.p(
              [h.Class('mt-3 text-sm text-stone-500')],
              ['No tags yet — type a name above to create the first one.'],
            ),
          ]
        : [
            h.div(
              [h.Class('mt-3 flex flex-wrap gap-1.5')],
              [
                ...inputs.tags.map((tag) => {
                  const isActive = inputs.activeSlug === tag.slug
                  return h.span(
                    [h.Key(`chip-${tag.slug}`), h.Class(chipClass(isActive))],
                    [
                      h.button(
                        [
                          h.OnClick(Message.ToggledFilter({ slug: tag.slug })),
                          h.Title(
                            isActive ? `Clear filter ${tag.label}` : `Filter by ${tag.label}`,
                          ),
                          h.AriaPressed(String(isActive)),
                          h.Class('flex min-w-0 items-center gap-1.5 py-1 pl-3'),
                        ],
                        [
                          h.span([h.Class('truncate text-xs font-medium')], [tag.label]),
                          countBadge(inputs.countFor?.(tag), isActive, h),
                        ],
                      ),
                      deleteButton(tag, h),
                    ],
                  )
                }),
              ],
            ),
          ]),
      h.p([h.Class('mt-3 text-xs text-stone-500')], [inputs.resultText]),
    ],
  ),
)
