import { Schema as S } from 'effect'

/**
 * Site Section — one entry in the public Folio nav, authored as an ordered list
 * in the Admin's settings singleton (see CONTEXT.md).
 *
 * The design draws SECTIONS as a single `ALL · STREET · LANDSCAPE · SERIES ·
 * ABOUT` string. That string cannot be routed, so a Section carries its own
 * destination: `kind` says what the destination is, `target` names it, and only
 * the three kinds that go somewhere carry one. The union is deliberate — a
 * Section that cannot point anywhere is not representable.
 */

const label = S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(40)))

/** A Tag's slug, or a page name — the shape `slugify` produces. */
const target = S.String.pipe(
  S.check(S.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  S.check(S.isMaxLength(80)),
)

/** The Front itself. */
const allSection = S.Struct({ kind: S.Literal('all'), label })

/** A Tag's page, ordered by takenAt. */
const tagSection = S.Struct({ kind: S.Literal('tag'), label, target })

/** A curated group, linked from a Tag's slug. A Series page *is* a Tag page
 *  (ADR 0008); the kind records how the author meant the entry. */
const seriesSection = S.Struct({ kind: S.Literal('series'), label, target })

/** A page of the site, named by its path segment. */
const pageSection = S.Struct({ kind: S.Literal('page'), label, target })

export const SiteSection = S.Union([allSection, tagSection, seriesSection, pageSection])
export type SiteSection = typeof SiteSection.Type

/** The whole nav, in the order it renders. */
export const SiteSections = S.Array(SiteSection).pipe(S.check(S.isMaxLength(16)))
export type SiteSections = typeof SiteSections.Type
