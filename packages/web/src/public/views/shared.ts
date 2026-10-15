/** Shared child-node type for the home region views. */
import type { Html } from 'foldkit/html'

export type Child = Html | string

/**
 * The page's content column. The About and Tag pages and the footer cap
 * themselves at this width, so every rule and every left edge lines up down the
 * page. The home page is the exception: its header, rows and footer run the
 * window's full width.
 */
export const BAND = 'mx-auto w-full max-w-[1080px]'

/** Shared cursor feedback timing, from `motion.duration.fast`. */
export const TRANSITION = 'transition-colors duration-120'
