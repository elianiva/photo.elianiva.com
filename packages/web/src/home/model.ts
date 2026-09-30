/**
 * Home Model + Message (the TEA core). The front page is one Edition of
 * photographs held in the Model and the lightbox's selection — nothing else.
 *
 * The Edition arrives as **Flags** rather than being imported as a module
 * constant, because it is read out of D1 on the Worker that renders it. foldkit
 * server-renders the Model into a hydration stamp and decodes it again in the
 * browser, so Flags are the seam that carries a value computed at request time
 * into a view that also has to run on the client. `init` is synchronous, so
 * the read happens before the render and the Edition is handed in whole.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { EditionSectionSchema, EditionSchema, FigureSchema } from './content'

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

/** What the Worker read before it rendered: the Edition itself, already mapped
 *  from the read, and the cursor below the last Section.
 *
 *  Emptiness is not a field here on purpose. It is a property of the Edition —
 *  no lead and no Sections — and a second flag beside it would be a second
 *  answer to "is there anything published", free to disagree with the first the
 *  moment a read returned a Section whose photographs were all undrawable. */
export const Flags = S.Struct({
  edition: EditionSchema,
  nextSectionCursor: S.NullOr(S.String),
})
export type Flags = typeof Flags.Type

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
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
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  ClickedFigure: { id: S.String },
  CloseLightbox: {},
  /** The reader asked for the Edition below the last one it has. */
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
