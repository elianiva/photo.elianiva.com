import type { Attribute, ChildAttribute, Html, HtmlBuilder } from 'foldkit/html'
import type { IconNode } from 'lucide'
import { Loader2 } from 'lucide'

import { cn } from '@/lib/utils'

export const spinnerClass = 'size-4 animate-spin'

type StyleConfig = Readonly<{ className?: string }>

const nodeToAttributes = <M>(
  attrs: Record<string, string>,
  h: HtmlBuilder<M>,
): ReadonlyArray<Attribute<M> | ChildAttribute> =>
  Object.entries(attrs).map(([name, value]) => h.Attribute(name, value))

const renderIconNode = <M>(node: IconNode, h: HtmlBuilder<M>): ReadonlyArray<Html> =>
  node.map(([tag, attrs]) => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const attributes = nodeToAttributes(attrs as Record<string, string>, h)
    return tag === 'path' ? h.path(attributes) : h.circle(attributes)
  })

/** Styled loading spinner — a `Loader2` lucide svg with `role="status"`. */
export const spinner = <M>(config: StyleConfig, h: HtmlBuilder<M>): Html =>
  h.svg(
    [
      h.DataAttribute('slot', 'spinner'),
      h.Role('status'),
      h.AriaLabel('Loading'),
      h.Class(cn(spinnerClass, config.className)),
      h.Xmlns('http://www.w3.org/2000/svg'),
      h.Fill('none'),
      h.ViewBox('0 0 24 24'),
      h.StrokeWidth('2'),
      h.Stroke('currentColor'),
      h.StrokeLinecap('round'),
      h.StrokeLinejoin('round'),
    ],
    renderIconNode(Loader2, h),
  )
