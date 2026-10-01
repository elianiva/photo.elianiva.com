/**
 * Rules: the broadsheet's only structure. The masthead and the colophon each
 * open with a three-band stack — hairline, bare stock, heavy — but in opposite
 * order: the masthead leans its weight into the nameplate above the folio, and
 * the colophon leans it into the fold at the page's foot.
 */

import type { HtmlBuilder } from 'foldkit/html'

import { Message } from '../model'
import type { Child } from './shared'

type RuleWeight = 'hair' | 'gap' | 'heavy'

const RULE_CLASS: Record<RuleWeight, string> = {
  hair: 'h-px bg-role-rule',
  gap: 'h-[2px]',
  heavy: 'h-[3px] bg-role-rule',
}

const rule = (weight: RuleWeight, h: HtmlBuilder<Message>): Child =>
  h.div([h.Class(RULE_CLASS[weight])], [])

const stack = (weights: ReadonlyArray<RuleWeight>, h: HtmlBuilder<Message>): Child =>
  h.div(
    [],
    weights.map((weight) => rule(weight, h)),
  )

/** The masthead's opening stack: heavy, bare stock, hairline. */
export const mastheadRules = (h: HtmlBuilder<Message>): Child => stack(['heavy', 'gap', 'hair'], h)

/** The colophon's opening stack: hairline, bare stock, heavy. */
export const colophonRules = (h: HtmlBuilder<Message>): Child => stack(['hair', 'gap', 'heavy'], h)
