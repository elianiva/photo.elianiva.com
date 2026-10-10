/**
 * Kit: the four facts a reader checking the work would want — the body, the
 * lens, since when, and what comes out. The design's Spec Row is a label and a
 * value ranged right under a hairline, so this is a description list of
 * `components/ui/spec-row` rows under a `KIT` label, and the values are the
 * same body and lens the Footer's EQUIPMENT column names.
 *
 * `OUTPUT — FULL RESOLUTION ONLY` is a fact about the site rather than about
 * the kit, and it is here because that is where the design puts it: every
 * photo and every download is the original's bytes out of R2, with no resizer
 * on the zone (ADR 0002). It is the one row a reader is most likely to be
 * wrong about before reading.
 *
 * The words are written here, where they render, like the rest of the page's
 * copy — Settings holds no site copy, and a second source for a sentence
 * nobody can find is not a source at all (migration 0008).
 */

import type { HtmlBuilder } from 'foldkit/html'

import * as SpecRow from '@/components/ui/spec-row'

import { Message } from '../model'
import type { Child } from './shared'

const ROWS: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
  { label: 'CAMERA', value: 'FUJIFILM X-T20' },
  { label: 'LENS', value: '25MM F/1.8' },
  { label: 'SINCE', value: '2021' },
  { label: 'OUTPUT', value: 'ORIGINAL FILES ONLY' },
]

export const kit = (h: HtmlBuilder<Message>): Child =>
  h.div(
    // The body's own gap and this table's own top padding are both in the
    // design, so the space between the last photo's Exif line and `KIT` is
    // their sum: 48px at `desktop`, 32px on the mobile master.
    [h.Class('flex flex-col pt-4 lg:pt-6')],
    [
      h.span([h.Class('type-label text-role-text-secondary')], ['KIT']),
      h.dl(
        [h.Class('flex flex-col')],
        ROWS.map((row) => SpecRow.specRow(row, h)),
      ),
    ],
  )
