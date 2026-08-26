/**
 * Justified-row gallery layout with optimal row breaking (the Knuth–Plass
 * adaptation used by Google Photos / react-photo-album — see Vjeux, "Google
 * Plus Layout – Find Best Breaks").
 *
 * Rows are chosen by a shortest-path search over a DAG: photo indices are
 * nodes, contiguous rows are edges, and each edge costs the squared deviation
 * of the row's aspect-ratio sum from the target. This finds the globally best
 * partition instead of Flickr's greedy first-fit seal.
 *
 * Rendering needs no pixel measurement: within a row every figure gets
 * `flex: <aspect> 1 0%`, so widths end up proportional to aspect ratios at
 * any container width and all images in the row share one height — a 3:2
 * landscape naturally takes over twice the width of a 2:3 portrait.
 */

export interface LayoutOptions {
  /** Ideal sum of width/height ratios for one full-width row. */
  readonly targetRowAspect: number
  /** Rows above this sum are forbidden (images would get too small). */
  readonly maxRowAspect: number
}

/**
 * Tuned for a 3:2 / 4:3 + 2:3 / 3:4 mix on a wide editorial canvas:
 * - landscape+portrait pairs land almost exactly on target (1.5 + 0.67 ≈ 2.17)
 * - two landscapes pair up; three portraits fit without crowding
 */
export const DEFAULT_LAYOUT: LayoutOptions = {
  targetRowAspect: 2.3,
  maxRowAspect: 2.9,
}

/** Defensive clamp against missing/absurd dimensions in stored metadata. */
const clampAspect = (aspect: number): number =>
  Number.isFinite(aspect) && aspect > 0 ? Math.min(Math.max(aspect, 0.5), 2.5) : 1

/** Sum of aspects for photos[i..j) after clamping. */
const rowAspect = (aspects: ReadonlyArray<number>, i: number, j: number): number => {
  let sum = 0
  for (let k = i; k < j; k += 1) sum += aspects[k] ?? 1
  return sum
}

/**
 * Partition photos into justified rows. Returns rows of indices into the
 * input array, in order. The final row's cost is relaxed to zero — it is
 * rendered left-aligned with a spacer absorbing the slack.
 */
export const breakRows = (
  aspects: ReadonlyArray<number>,
  options: LayoutOptions = DEFAULT_LAYOUT,
): ReadonlyArray<ReadonlyArray<number>> => {
  const { targetRowAspect, maxRowAspect } = options
  const n = aspects.length
  if (n === 0) return []

  // dp[i] — minimal total cost for photos[i..n); next[i] — the row end.
  const dp = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY)
  const next = new Array<number>(n).fill(n)
  dp[n] = 0

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = i + 1; j <= n; j += 1) {
      const sum = rowAspect(aspects, i, j)
      if (sum > maxRowAspect) break
      const cost = j === n ? 0 : (sum - targetRowAspect) ** 2
      const total = cost + (dp[j] ?? Number.POSITIVE_INFINITY)
      if (total < (dp[i] ?? Number.POSITIVE_INFINITY)) {
        dp[i] = total
        next[i] = j
      }
    }
    // No feasible row start (degenerate input) — force a single-photo row so
    // the walk below always terminates.
    if (!Number.isFinite(dp[i])) {
      dp[i] = 0
      next[i] = i + 1
    }
  }

  const rows: Array<Array<number>> = []
  let i = 0
  while (i < n) {
    const j = next[i] ?? i + 1
    rows.push(Array.from({ length: j - i }, (_, k) => i + k))
    i = j
  }
  return rows
}

/** Clamped aspect ratios ready for both breaking and flex rendering. */
export const toAspects = (
  photos: ReadonlyArray<{ readonly width: number; readonly height: number }>,
): ReadonlyArray<number> =>
  photos.map((photo) => clampAspect(photo.width / Math.max(photo.height, 1)))

/** Slack left in the final row relative to the target (≥ 0 when positive). */
export const lastRowSlack = (
  aspects: ReadonlyArray<number>,
  rows: ReadonlyArray<ReadonlyArray<number>>,
  options: LayoutOptions = DEFAULT_LAYOUT,
): number => {
  const last = rows[rows.length - 1]
  if (last === undefined || last.length === 0) return 0
  const sum = rowAspect(aspects, last[0] ?? 0, (last[last.length - 1] ?? 0) + 1)
  return Math.max(options.targetRowAspect - sum, 0)
}
