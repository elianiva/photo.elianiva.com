/**
 * Nav Link: the folio's section list and its RSS entry. The current section is
 * marked by a rule under the label, not by colour alone.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../model'
import { TRANSITION, type Child } from './shared'

export const navLink = (
  label: string,
  href: string,
  state: 'active' | 'default',
  h: HtmlBuilder<Message>,
): Child =>
  h.a(
    [
      h.Href(href),
      h.Class(
        state === 'active'
          ? `type-kicker border-b border-role-rule pb-(--spacing-xs) text-role-text-primary hover:text-role-text-primary ${TRANSITION}`
          : `type-kicker text-role-text-secondary hover:text-role-text-primary ${TRANSITION}`,
      ),
    ],
    [label],
  )
