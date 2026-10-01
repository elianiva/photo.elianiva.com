/**
 * Slider — the Desk's numeric slider (the canvas's `Slider` master): a head row
 * with the kicker label left and the value right in `$typography.exif`, 8px
 * below it a 16px track carrying a 2px `color.rule` fill, a 1px `color.outline`
 * rest, and a 12px `color.surface` knob ringed in 1.5px of `color.rule`.
 *
 * The track is drawn here rather than by the element, so the fill and the knob
 * can both be placed from one percentage. A native range input rides on top of
 * them, transparent, and keeps the part that cannot be drawn — the arrow keys,
 * Home and End, the value a screen reader announces, and the pointer drag. Its
 * own thumb is 16px of hit area at zero opacity, which is why dragging still
 * works over a knob it never shows.
 */
import type { Html, HtmlBuilder } from 'foldkit/html'

import { cn } from '@/lib/utils'

export const sliderLabelClass = 'type-kicker text-role-text-secondary'
export const sliderValueClass = 'type-exif text-role-text-primary'

/** The transparent control over the drawn track. The 2px outline is the focus
 *  ring the invisible element would otherwise lose. */
export const sliderInputClass =
  'focus-visible:outline-role-focus absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-2 outline-offset-2 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:opacity-0 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:opacity-0'

export type SliderConfig<M> = Readonly<{
  id: string
  label: string
  value: number
  min: number
  max: number
  step: number
  /** What the head prints — `82`, or `4.2 GB` where the value is a measurement. */
  display?: string
  onInput: (value: number) => M
  isDisabled?: boolean
  className?: string
}>

/** Where the value sits along the track, clamped: a value outside the range
 *  would draw a knob off the end of a rail that does not move. */
const percentOf = (value: number, min: number, max: number): number =>
  max <= min ? 0 : Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))

/** One slider. The drawn track is `aria-hidden`: the value is the element's,
 *  and a second copy of it in the DOM is a second thing to read. */
export const slider = <M>(config: SliderConfig<M>, h: HtmlBuilder<M>): Html => {
  const percent = percentOf(config.value, config.min, config.max)
  return h.div(
    [h.Class(cn('flex w-full flex-col gap-2', config.className))],
    [
      h.div(
        [h.Class('flex items-center justify-between gap-2')],
        [
          h.label([h.For(config.id), h.Class(sliderLabelClass)], [config.label]),
          h.span([h.Class(sliderValueClass)], [config.display ?? String(config.value)]),
        ],
      ),
      h.div(
        [h.Class('relative h-4 w-full')],
        [
          h.div(
            [h.AriaHidden(true), h.Class('pointer-events-none absolute inset-0')],
            [
              // The rest, the fill, then the knob over the join.
              h.div(
                [h.Class('absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-role-outline')],
                [],
              ),
              h.div(
                [
                  h.Class('absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-role-rule'),
                  h.Style({ width: `${percent.toFixed(2)}%` }),
                ],
                [],
              ),
              h.div(
                [
                  h.Class(
                    'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-role-rule bg-role-surface',
                  ),
                  h.Style({ left: `${percent.toFixed(2)}%` }),
                ],
                [],
              ),
            ],
          ),
          h.input([
            h.Id(config.id),
            h.Type('range'),
            h.Value(String(config.value)),
            h.Min(String(config.min)),
            h.Max(String(config.max)),
            h.Step(String(config.step)),
            h.OnInput((raw) => config.onInput(Number(raw))),
            ...(config.isDisabled === true ? [h.Disabled(true)] : []),
            h.Class(sliderInputClass),
            h.DataAttribute('slot', 'slider'),
          ]),
        ],
      ),
    ],
  )
}
