/** Shared child-node type for the home region views. */
import type { Html } from 'foldkit/html'

export type Child = Html | string

/**
 * The page's content column. Bands are full-bleed elements — masthead, lede,
 * each section, the tail, the colophon — and cap themselves at this width, so
 * every rule and every left edge lines up down the whole page.
 */
export const BAND = 'mx-auto w-full max-w-[1080px]'

/** Shared cursor feedback timing, from `motion.duration.fast`. */
export const TRANSITION = 'transition-colors duration-120'
