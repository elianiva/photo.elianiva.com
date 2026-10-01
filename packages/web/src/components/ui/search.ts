/**
 * Search — the Page Head's search field (master `161b3a35df9631c7`). 36px tall,
 * 8px of padding around a 14px `color.text.secondary` `magnifying-glass`, the
 * typed value in `$typography.body`, and a 1px `color.outline` bottom rule.
 * The placeholder is the italic `$typography.caption` in `color.text.disabled`,
 * which is the Desk's resting voice. The keycap is `color.text.secondary` rather
 * than `color.text.disabled`: it is a real key the operator can press, and
 * `color.text.disabled` is 3.6:1 on the page's surface — under the 4.5:1 a 10px
 * `$typography.exif` line needs.
 *
 * `hint` is the keycap the design prints at the right (`⌘K`), and it is an
 * argument rather than a fixed part of the atom: the hint promises a shortcut,
 * so only a page that owns the shortcut should pass one. The Page Head owns it
 * — as a document Subscription that focuses this input — so the atom only
 * draws it.
 */
import { Search } from 'lucide'
import type { Html, HtmlBuilder } from 'foldkit/html'

import { icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type SearchConfig<M> = Readonly<{
  id: string
  value: string
  onInput?: (value: string) => M
  placeholder?: string
  /** Keycap hint for a shortcut the *page* owns, e.g. `⌘K`. */
  hint?: string
  ariaLabel?: string
  isDisabled?: boolean
  className?: string
}>

export const searchClass =
  'placeholder:text-role-text-disabled focus-within:border-role-rule flex h-9 w-full items-center gap-2 border-b border-role-outline bg-transparent px-2 text-role-text-primary transition-colors duration-120'

/** The Page Head's search field. */
export const search = <M>(config: SearchConfig<M>, h: HtmlBuilder<M>): Html =>
  h.div(
    [h.Class(cn(searchClass, config.className)), h.DataAttribute('slot', 'search')],
    [
      icon(h, Search, 'size-3.5 shrink-0 text-role-text-secondary'),
      h.input([
        h.Id(config.id),
        h.Type('search'),
        h.Value(config.value),
        h.Class(
          'placeholder:italic min-w-0 flex-1 bg-transparent type-body outline-none disabled:cursor-not-allowed',
        ),
        ...(config.placeholder === undefined ? [] : [h.Placeholder(config.placeholder)]),
        ...(config.ariaLabel === undefined ? [] : [h.AriaLabel(config.ariaLabel)]),
        ...(config.isDisabled === true ? [h.Disabled(true)] : []),
        ...(config.onInput === undefined ? [] : [h.OnInput(config.onInput)]),
      ]),
      ...(config.hint === undefined
        ? []
        : [
            h.kbd(
              [h.AriaHidden(true), h.Class('type-exif shrink-0 text-role-text-secondary')],
              [config.hint],
            ),
          ]),
    ],
  )
