/** Shared child-node type for the home region views. */
import type { Html } from 'foldkit/html'

export type Child = Html | string

/**
 * The page's content column. Bands are full-bleed elements — header, intro,
 * each section, the tail, the footer — and cap themselves at this width, so
 * every rule and every left edge lines up down the whole page.
 */
export const BAND = 'mx-auto w-full max-w-[1080px]'

/** Shared cursor feedback timing, from `motion.duration.fast`. */
export const TRANSITION = 'transition-colors duration-120'

/** A visible, stable tilt in degrees. The magnitude comes from the photo's id so
 *  it never changes between renders; the sign alternates down a column and
 *  flips between neighbouring columns, so a right tilt is always followed by a
 *  left one. */
export const tiltFor = (id: string, position: number): number => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const magnitude = 1.5 + ((hash % 100) / 100) * 2
  return ((position % 2 === 0 ? 1 : -1) * Math.round(magnitude * 100)) / 100
}
