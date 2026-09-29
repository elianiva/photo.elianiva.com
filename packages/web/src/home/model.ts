/**
 * Home Model + Message (the TEA core). The front page is one Edition held in
 * the Model and nothing else — the content is a static module, not an RPC
 * result, so there are no Flags and `init` takes no argument.
 */

import { Schema as S } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { EditionSchema, FigureSchema } from './content'

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = S.Struct({
  edition: EditionSchema,
  /** Figure shown in the lightbox; null while reading the front page. */
  selected: S.NullOr(FigureSchema),
})
export type Model = typeof Model.Type

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const Message = defineMessageUnion({
  ClickedFigure: { id: S.String },
  CloseLightbox: {},
})
export type Message = typeof Message.Type
