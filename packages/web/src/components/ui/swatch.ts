/**
 * Swatch — one Mat colour (master `276832b15f24965b`). A 32px circle holding a
 * 22px chip on 4px of padding; the chip carries the mat colour itself over a
 * 1px `color.outline` ring so a white mat still reads on paper.
 *
 * Selection is a 1.5px `color.rule` ring around the 32px circle. The
 * unselected ring is transparent rather than absent, so picking a colour does
 * not shift the row.
 *
 * `color.mat.*` does not theme: paper is paper in both branches, because it is
 * the colour of the thing being framed.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

/** A Mat's three colours (CONTEXT.md, Mat). */
export const matColours = ['white', 'paper', 'ink'] as const
export type MatColour = (typeof matColours)[number]

const chipColours: Record<MatColour, string> = {
  white: 'bg-role-mat-white',
  paper: 'bg-role-mat-paper',
  ink: 'bg-role-mat-ink',
}

export type SwatchConfig<M> = Readonly<{
  colour: MatColour
  isSelected: boolean
  /** What the operator reads the swatch as — the colour's name. */
  label: string
  onSelect?: M
  className?: string
}>

/** One Mat colour, as a swatch. */
export const swatch = <M>(config: SwatchConfig<M>, h: HtmlBuilder<M>): Html =>
  h.button(
    [
      h.Type('button'),
      h.AriaLabel(config.label),
      h.AriaPressed(String(config.isSelected)),
      ...(config.onSelect === undefined ? [] : [h.OnClick(config.onSelect)]),
      h.Class(
        cn(
          'focus-visible:ring-role-focus/50 inline-flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] bg-transparent p-(--spacing-xs) outline-none transition-colors duration-(--motion-duration-fast) focus-visible:ring-[3px]',
          config.isSelected ? 'border-role-rule' : 'border-transparent',
          config.className,
        ),
      ),
      h.DataAttribute('slot', 'swatch'),
      h.DataAttribute('colour', config.colour),
    ],
    [
      h.span([
        h.AriaHidden(true),
        h.Class(
          cn('size-[22px] rounded-full border border-role-outline', chipColours[config.colour]),
        ),
      ]),
    ],
  )
