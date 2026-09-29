/**
 * Theme scope. The broadsheet design system has two branches, `light` and
 * `dark`, and the generator emits both as plain custom properties under a
 * scope selector (`tokens.css` sections 4 and 5). A theme is therefore a
 * matter of naming the scope on the element the app is rendered into, not of
 * shipping a second palette.
 *
 * `.dark` on the document root is the same block spelled as a class; the
 * Editor uses the attribute so it can be dark as a subtree while the Library
 * around it stays light. The scope has to be named by the view rather than
 * toggled after mount, because the first paint is the one that must not
 * flash: the value is a pure function of the path, so the server render and
 * the client mount agree.
 */

import { Schema as S } from 'effect'
import type { Attribute, HtmlBuilder } from 'foldkit/html'

export const Theme = S.Literals(['light', 'dark'])
export type Theme = typeof Theme.Type

/** The attribute the generated scopes key off. */
export const themeAttribute = 'data-theme'

/**
 * The path prefix the Editor owns. Reserved ahead of the route so the dark
 * scope is live and reachable today, and so the Editor route shell lands in
 * an address space that is already themed.
 */
const EDITOR_PREFIX = '/admin/photo'

/** The broadsheet branch a path is drawn in. */
export const themeForPath = (pathname: string): Theme =>
  pathname === EDITOR_PREFIX || pathname.startsWith(`${EDITOR_PREFIX}/`) ? 'dark' : 'light'

/** The scope attribute for a branch, as a foldkit attribute. */
export const scopeTheme = <M>(theme: Theme, h: HtmlBuilder<M>): Attribute<M> =>
  h.Attribute(themeAttribute, theme)
