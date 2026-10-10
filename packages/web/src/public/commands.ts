/**
 * The home page's one command: read the months below the one the page ends on.
 *
 * It is a client-side read rather than a navigation because appending a Month
 * is the same page with more of it — the load-more row moves down and more
 * photographs appear above it. Navigating would throw away the Months already
 * rendered and make the reader scroll back past them.
 *
 * The read goes to the public group, which filters to published, non-trashed
 * Photos inside `PublicPhotoService`, so a Draft cannot be appended to the home page
 * by asking for an older month. The Months are mapped by `monthsOf`, the
 * same function the Worker used for the first read, so an appended month is
 * drawn exactly as a server-rendered one is.
 */

import { Effect, Schema as S } from 'effect'
import { Command } from 'foldkit'

import type { PublicSection } from '@photo/api'
import { rpcPublic } from '@/lib/rpc'
import { monthsOf } from './content'
import { Message } from './model'

/** The public read's answer, as the public group declares it. The response is
 *  already validated against that schema on the server boundary, so the shape
 *  is a type here rather than a second Schema to drift from it. Only the
 *  Months come back into the page: the counters in the same answer describe
 *  the site rather than this page, and the page prints neither. */
type HomePageRead = {
  readonly sections: ReadonlyArray<PublicSection>
  readonly nextMonthCursor: string | null
}

export const LoadOlderMonthsCmd = Command.define('LoadOlderMonths', {
  args: { sectionCursor: S.String },
  messages: [Message.LoadedMonths, Message.FailedLoadMonths],
  execute: ({ sectionCursor }) =>
    Effect.map(
      rpcPublic<HomePageRead>('GetFrontPage', { sectionCursor, sectionCount: 2 }),
      (read) =>
        Message.LoadedMonths({
          months: monthsOf(read.sections),
          nextMonthCursor: read.nextMonthCursor,
        }),
    ).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedLoadMonths({ message: error.message }))),
    ),
})
