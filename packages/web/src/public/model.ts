/**
 * The public site's Model + Message (the TEA core). One app draws the site's
 * public documents: the Front is an Edition of photographs held in the Model,
 * the About page is the plates it leads with, a Tag page is that Tag and its
 * plates, and the Folio and the lightbox's selection are the two things all
 * three carry.
 *
 * Which document is drawn is the **route** (see `route.ts`), read off the
 * Model rather than off the path again: the Worker decides the route from the
 * request, stamps it in the Flags, and the view reads it back off the Model, so
 * a page can never be rendered for a URL that did not ask for it.
 *
 * The read arrives as **Flags** rather than being imported as a module
 * constant, because it is read out of D1 on the Worker that renders the page.
 * foldkit server-renders the Model into a hydration stamp and decodes it again
 * in the browser, so Flags are the seam that carries a value computed at
 * request time into a view that also has to run on the client. `init` is
 * synchronous, so the read happens before the render and the value is handed
 * in whole.
 *
 * Flags are a union because the documents are handed different things: the
 * Front is rendered from an Edition and the About page and a Tag page from
 * plates, and a shared struct would have the About page's stamp carrying an
 * Edition it never prints.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import {
  EditionSectionSchema,
  EditionSchema,
  FigureSchema,
  FolioEntrySchema,
  TagPageSchema,
} from './content'
import { PublicRoute } from './route'

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** What the Worker read before it rendered. One struct rather than a union of
 *  per-document structs, and the reason is the framework's: the hydration
 *  seam is typed as a `Schema.Codec`, and a `Schema.Union` has no `Rebuild`, so
 *  a union cannot be the Flags a server render accepts. So the `route` says
 *  which document is being drawn, and the other documents' fields are empty in
 *  the stamp — an About page carries no Edition, a Front carries no plates —
 *  which is what `init` and the view read and never the other way round.
 *
 *  For the Front: the Edition itself, already mapped from the read, and the
 *  cursor below the last Section. Emptiness is not a field there on purpose.
 *  It is a property of the Edition — no lead and no Sections — and a second flag
 *  beside it would be a second answer to "is there anything published", free to
 *  disagree with the first the moment a read returned a Section whose
 *  photographs were all undrawable.
 *
 *  For the About page: the plates the page shows, mapped from the same read
 *  model, newest first. A site with nothing published is a real state and the
 *  page is the prose and the kit with no plate on it.
 *
 *  For a Tag page: the Tag and its own plates, earliest first. A Tag page
 *  carries no Edition, because it is a list of one Tag's photographs rather
 *  than a run of months.
 *
 *  `folio` is on every document rather than one of them: the Folio is the
 *  Masthead's, and the Masthead is the chrome all three documents share. An
 *  empty Folio is a site with no published photograph under any Tag, which is
 *  a real state — a nav of `ALL` and `ABOUT` and nothing between them. */
export const Flags = S.Struct({
  route: PublicRoute,
  edition: EditionSchema,
  nextSectionCursor: S.NullOr(S.String),
  plates: S.Array(FigureSchema),
  tag: TagPageSchema,
  folio: S.Array(FolioEntrySchema),
})
export type Flags = typeof Flags.Type

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  /** Which public document this Model draws. The two documents share the
   *  chrome, the plates and the lightbox, so the Model is one struct with both
   *  documents' fields rather than a union: `init` fills the one the route did
   *  not ask for with the empty edition, and the view never reads it. */
  route: PublicRoute,
  edition: EditionSchema,
  /** Figure shown in the lightbox; null while reading the front page. */
  selected: S.NullOr(FigureSchema),
  /** The month below the last Section, or null when there are no older ones.
   *  The Continued row is the only thing that acts on it. */
  sectionCursor: S.NullOr(S.String),
  /** True while an older Section is in flight, so the row cannot be clicked
   *  twice into two overlapping reads. */
  loadingSections: S.Boolean,
  /** Why the last attempt to load an older Section failed, or null. The
   *  Sections already on the page stay either way; the row says so rather than
   *  pretending the issue ended. */
  sectionsError: S.NullOr(S.String),
  /** The About page's plates, in the order the read returned them. Empty on
   *  the Front, which reads photographs out of its Edition, and on a Tag page,
   *  which reads its own Tag's photographs out of `tag`. */
  plates: S.Array(FigureSchema),
  /** The Folio's entries: one per Tag a visitor can go to, in the order the
   *  read returned them. On every document, because the Masthead that draws the
   *  nav is chrome the three of them share. */
  folio: S.Array(FolioEntrySchema),
  /** The Tag this document is about, or the named empty one on the Front and
   *  the About page. A Tag page is a Tag's page (ADR 0006), so the slug in
   *  here is also the URL the Folio's link points at. */
  tag: TagPageSchema,
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  ClickedFigure: { id: S.String },
  CloseLightbox: {},
  /** The reader asked for the Edition below the last one it has. A Tag page
   *  draws no Continued row — it is one Tag's photographs, read whole before the
   *  render — so this is the Front's message alone. */
  LoadOlderSections: {},
  /** Those Sections arrived, and they were the last ones. */
  LoadedSections: {
    sections: S.Array(EditionSectionSchema),
    nextSectionCursor: S.NullOr(S.String),
  },
  /** The read failed. The Edition already on the page stays; the row offers a
   *  retry rather than pretending the issue ended. */
  FailedLoadSections: { message: S.String },
})
export type Message = typeof Message.Type
