/**
 * Tag page: one Tag's published photographs, under the Tag's own name.
 *
 * There is no Series entity and no curated order (ADR 0006) — a Series page
 * *is* a Tag page, so this is the Tag's label, the Tag's caption and the
 * photographs carrying it, earliest first, which makes the head of the list the
 * page's cover. The Folio's link to it is the only way in, which is why the
 * page draws no kicker of its own: the name in the masthead is already the name
 * at the top of the page, and a second word above it would be a category the
 * schema does not have.
 *
 * The composition is the design's own document shape — a headline, a deck and
 * plates — at the Front's measure, because a Tag's photographs are a run of
 * plates rather than the About page's single wide one. The count rides under
 * the name the way an Edition Section's does, and it counts photographs, which
 * is the one thing the site counts.
 *
 * The words here are the Tag's own, read from D1, because a Tag's label and
 * caption are the operator's to write in the Admin. There is no copy of the
 * site's own on this page: a Tag nobody has captioned has no deck, and the
 * element is left out rather than printed empty.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { frameCount, type TagPage } from '../content'
import { Message } from '../model'
import { plateColumns } from './plates'
import { BAND, type Child } from './shared'

export const tagBody = (tag: TagPage, h: HtmlBuilder<Message>): Child =>
  h.div(
    [
      h.Id('tag'),
      h.Class(
        `${BAND} flex flex-col gap-(--spacing-sm) pt-(--spacing-2xl) desktop:gap-(--spacing-md) desktop:pt-(--spacing-3xl)`,
      ),
    ],
    [
      h.h1([h.Class('type-section text-role-text-primary')], [tag.label]),
      ...(tag.caption === null
        ? []
        : [h.p([h.Class('type-deck text-role-text-secondary')], [tag.caption])]),
      h.div(
        [
          h.Class(
            'flex items-end justify-between gap-(--spacing-md) border-t border-role-rule pt-(--spacing-md) desktop:gap-(--spacing-lg)',
          ),
        ],
        // The Section head's right-hand line, ranged the same way: a Tag's page
        // has no month to head it, so the count is the whole line.
        [
          h.span(
            [h.Class('type-kicker text-role-text-secondary')],
            [frameCount(tag.plates.length)],
          ),
        ],
      ),
      // A Tag with no published photograph under it is a page with a name and
      // no plate on it — the same honest state the About page draws for an
      // empty read, rather than an empty column of frames.
      ...(tag.plates.length === 0 ? [] : plateColumns(tag.plates, h)),
    ],
  )
