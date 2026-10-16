/**
 * What a crawler and a link preview read off a public page: the title, the
 * description, the canonical URL, the Open Graph and Twitter tags, and the
 * structured data.
 *
 * The client template (`index.html`) is one file for every document, so it can
 * only carry what is true of all of them. Everything that depends on the page —
 * its canonical URL above all — is written here and spliced into the template's
 * head by the Worker, per request. A template that carried the home page's
 * canonical and description for every URL told search engines that `/about` and
 * every Tag page was the home page.
 *
 * The strings are plain on purpose: this module is read by the Worker, which
 * writes the tags, and by `public/view.ts`, which writes the same title to
 * `document.title`, so the title a crawler reads and the one a tab shows cannot
 * drift apart.
 */

import { routePath, type PublicLocation } from '@/public/route'

export const SITE = {
  /** No trailing slash: every path below starts with one. */
  url: 'https://photo.elianiva.com',
  name: 'photo.elianiva.com',
  locale: 'en_US',
  language: 'en',
  /** The card `scripts/og.ts` renders. One for every page, because nothing on it
   *  depends on the archive. */
  ogImage: {
    path: '/og.png',
    width: 1200,
    height: 630,
    alt: 'photo.elianiva.com, street photography by elianiva',
  },
} as const

/** The photographer. The personal site is the person's own home on the web, and
 *  the profiles below are the ones it already links, so a search engine can tie
 *  this site to them. */
const PERSON = {
  name: 'Dicha Zelianivan Arkana',
  alternateName: 'elianiva',
  url: 'https://elianiva.com',
  sameAs: [
    'https://github.com/elianiva',
    'https://www.instagram.com/not.elianiva',
    'https://bsky.app/profile/elianiva.com',
    'https://x.com/elianiva_',
    'https://www.linkedin.com/in/dichaa',
  ],
} as const

/** The tag page's own words, which is all the Worker knows about a Tag. */
export interface SeoTag {
  readonly label: string
  readonly caption: string | null
}

export interface Seo {
  readonly title: string
  readonly description: string
  /** The path the canonical URL is written from. */
  readonly path: string
  readonly jsonLd: ReadonlyArray<unknown>
}

const HOME_DESCRIPTION =
  'Street photography by elianiva, a software engineer who walks around the neighbourhood with a camera. Every photo is the original file, shown as shot.'

const ABOUT_DESCRIPTION =
  'About photo.elianiva.com: a software engineer’s hobby street photography, shot on a Fujifilm X-T20 and shown as the original files.'

/** A search result shows about this much. */
const DESCRIPTION_LIMIT = 160

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`

/**
 * The document's title: the site's name plus what the page is, in the site's
 * own lowercase (see `public/view.ts` for why). A Tag page's is its Tag's label.
 */
export const titleFor = (route: PublicLocation['route'], tagLabel: string): string => {
  switch (route) {
    case 'home':
      return `${SITE.name} — photography`
    case 'about':
      return `${SITE.name} — about`
    case 'tag':
      return `${SITE.name} — ${tagLabel}`
  }
}

const absolute = (path: string): string => `${SITE.url}${path}`

const personNode = () => ({
  '@type': 'Person',
  '@id': absolute('/#person'),
  name: PERSON.name,
  alternateName: PERSON.alternateName,
  url: PERSON.url,
  sameAs: PERSON.sameAs,
})

const websiteNode = () => ({
  '@type': 'WebSite',
  '@id': absolute('/#website'),
  url: absolute('/'),
  name: SITE.name,
  description: HOME_DESCRIPTION,
  inLanguage: SITE.language,
  publisher: { '@id': absolute('/#person') },
  author: { '@id': absolute('/#person') },
})

const breadcrumbNode = (
  trail: ReadonlyArray<{ readonly name: string; readonly path: string }>,
) => ({
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.name,
    item: absolute(entry.path),
  })),
})

const pageNode = (
  type: string,
  seo: Pick<Seo, 'title' | 'description' | 'path'>,
  extra: Record<string, unknown> = {},
) => ({
  '@type': type,
  '@id': absolute(`${seo.path}#webpage`),
  url: absolute(seo.path),
  name: seo.title,
  description: seo.description,
  inLanguage: SITE.language,
  isPartOf: { '@id': absolute('/#website') },
  primaryImageOfPage: {
    '@type': 'ImageObject',
    url: absolute(SITE.ogImage.path),
    width: SITE.ogImage.width,
    height: SITE.ogImage.height,
  },
  ...extra,
})

/** What a page says about itself, by location. */
export const seoFor = (location: PublicLocation, tag: SeoTag | null): Seo => {
  const path = routePath(location)
  const tagLabel = tag?.label ?? ''
  const title = titleFor(location.route, tagLabel)
  const base = { title, path }

  switch (location.route) {
    case 'home': {
      const description = HOME_DESCRIPTION
      return {
        ...base,
        description,
        jsonLd: [
          personNode(),
          websiteNode(),
          pageNode(
            'ImageGallery',
            { ...base, description },
            { author: { '@id': absolute('/#person') } },
          ),
        ],
      }
    }
    case 'about': {
      const description = ABOUT_DESCRIPTION
      return {
        ...base,
        description,
        jsonLd: [
          personNode(),
          websiteNode(),
          pageNode(
            'AboutPage',
            { ...base, description },
            { mainEntity: { '@id': absolute('/#person') } },
          ),
          breadcrumbNode([
            { name: 'Home', path: '/' },
            { name: 'About', path },
          ]),
        ],
      }
    }
    case 'tag': {
      const description = truncate(
        tag?.caption ?? `Photographs tagged ${tagLabel} on ${SITE.name}.`,
        DESCRIPTION_LIMIT,
      )
      return {
        ...base,
        description,
        jsonLd: [
          personNode(),
          websiteNode(),
          pageNode(
            'CollectionPage',
            { ...base, description },
            { author: { '@id': absolute('/#person') } },
          ),
          breadcrumbNode([
            { name: 'Home', path: '/' },
            { name: tagLabel, path },
          ]),
        ],
      }
    }
  }
}

/** A value in a double-quoted attribute. Tag labels and captions are the
 *  operator's own words, so they can hold any of these. */
const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** JSON inside `<script>`: a `<` in a string would otherwise let `</script>`
 *  end the element early, and the `U+2028` pair breaks older parsers. */
const escapeJsonForScript = (json: string): string =>
  json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

const meta = (key: 'name' | 'property', name: string, content: string): string =>
  `<meta ${key}="${escapeAttribute(name)}" content="${escapeAttribute(content)}" />`

/** The head tags for one page, as markup. */
export const headTags = (seo: Seo): string => {
  const url = absolute(seo.path)
  const image = absolute(SITE.ogImage.path)
  return [
    meta('name', 'description', seo.description),
    meta('name', 'robots', 'index, follow, max-image-preview:large'),
    `<link rel="canonical" href="${escapeAttribute(url)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE.name),
    meta('property', 'og:locale', SITE.locale),
    meta('property', 'og:title', seo.title),
    meta('property', 'og:description', seo.description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', String(SITE.ogImage.width)),
    meta('property', 'og:image:height', String(SITE.ogImage.height)),
    meta('property', 'og:image:alt', SITE.ogImage.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', seo.title),
    meta('name', 'twitter:description', seo.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', SITE.ogImage.alt),
    `<script type="application/ld+json">${escapeJsonForScript(
      JSON.stringify({ '@context': 'https://schema.org', '@graph': seo.jsonLd }),
    )}</script>`,
  ].join('\n    ')
}

/** The tag the Admin shell carries: the Desk is not for search engines, and the
 *  shell is the one document the Worker serves that is not a public page. */
export const NOINDEX_TAG = '<meta name="robots" content="noindex, nofollow" />'

/** The template with `tags` at the end of its head. The template's own title is
 *  left for Foldkit to rewrite from the view, so it is not touched here. */
export const injectHead = (template: string, tags: string): string => {
  const close = template.indexOf('</head>')
  return close === -1
    ? template
    : `${template.slice(0, close)}  ${tags}\n  ${template.slice(close)}`
}
