/**
 * The Front's one command: read the Edition below the month the page ends on.
 *
 * It is a client-side read rather than a navigation because appending a Section
 * is the same page with more of it — the masthead's count rises and the
 * Continued row moves down. Navigating would throw away the Sections already
 * rendered and make the reader scroll back past them.
 *
 * The read goes to the public group, which filters to published, non-trashed
 * Photos inside `PublicPhotoService`, so a Draft cannot be appended to the Front
 * by asking for an older month. The Sections are mapped by `sectionsOf`, the
 * same function the Worker used for the first read, so an appended month is
 * drawn exactly as a server-rendered one is.
 */

import { Effect, Schema as S } from 'effect'
import { Command } from 'foldkit'

import type { FrontStats, PublicSection } from '@photo/api'
import { rpcPublic } from '@/lib/rpc'
import { sectionsOf } from './content'
import { Message } from './model'

/** The public read's answer, as the public group declares it. The response is
 *  already validated against that schema on the server boundary, so the shape
 *  is a type here rather than a second Schema to drift from it. */
type FrontPageRead = {
  readonly sections: ReadonlyArray<PublicSection>
  readonly nextSectionCursor: string | null
  readonly stats: FrontStats
}

export const LoadOlderSectionsCmd = Command.define('LoadOlderSections', {
  args: { sectionCursor: S.String },
  messages: [Message.LoadedSections, Message.FailedLoadSections],
  execute: ({ sectionCursor }) =>
    Effect.map(
      rpcPublic<FrontPageRead>('GetFrontPage', { sectionCursor, sectionCount: 2 }),
      (read) =>
        Message.LoadedSections({
          sections: sectionsOf(read.sections),
          nextSectionCursor: read.nextSectionCursor,
          number: read.stats.number,
          total: read.stats.total,
        }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.FailedLoadSections({ message: error.message })),
      ),
    ),
})
