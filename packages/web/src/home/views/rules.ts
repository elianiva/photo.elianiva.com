/**
 * Rules: the broadsheet's only structure. The masthead and the colophon each
 * open with the same three-band stack — hairline, paper, heavy — the middle
 * band being the 2px of bare stock the design leaves between the two rules.
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

export const ruleStack = (h: HtmlBuilder<Message>): Child =>
  h.div([], [rule('hair', h), rule('gap', h), rule('heavy', h)])
