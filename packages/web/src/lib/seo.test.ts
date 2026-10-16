import { describe, expect, it } from 'vitest'

import { SITE, headTags, injectHead, seoFor, titleFor } from './seo'

const jsonLdOf = (markup: string): { '@graph': ReadonlyArray<Record<string, unknown>> } => {
  const match = markup.match(/<script type="application\/ld\+json">(.*)<\/script>/s)
  if (match?.[1] === undefined) throw new Error('no JSON-LD in head tags')
  return JSON.parse(match[1])
}

describe('the head tags a page carries', () => {
  it('gives each document its own canonical URL, never the home page’s', () => {
    // The template used to carry one canonical for every URL, which told search
    // engines that /about and every Tag page was the home page.
    const canonicalOf = (markup: string) => markup.match(/rel="canonical" href="([^"]*)"/)?.[1]
    expect(canonicalOf(headTags(seoFor({ route: 'home' }, null)))).toBe(`${SITE.url}/`)
    expect(canonicalOf(headTags(seoFor({ route: 'about' }, null)))).toBe(`${SITE.url}/about`)
    expect(
      canonicalOf(
        headTags(seoFor({ route: 'tag', tagSlug: 'night' }, { label: 'night', caption: null })),
      ),
    ).toBe(`${SITE.url}/tag/night`)
  })

  it('writes the same title the view draws into the tab', () => {
    const tag = { label: 'night', caption: null }
    expect(seoFor({ route: 'tag', tagSlug: 'night' }, tag).title).toBe(titleFor('tag', 'night'))
    expect(seoFor({ route: 'home' }, null).title).toBe(titleFor('home', ''))
  })

  it('asks for a large preview with the card, at the size the card is', () => {
    const markup = headTags(seoFor({ route: 'home' }, null))
    expect(markup).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(markup).toContain(`<meta property="og:image" content="${SITE.url}/og.png" />`)
    expect(markup).toContain('<meta property="og:image:width" content="1200" />')
    expect(markup).toContain('<meta property="og:image:height" content="630" />')
  })

  it('uses a Tag’s caption as its description and falls back to a sentence', () => {
    const captioned = seoFor({ route: 'tag', tagSlug: 'a' }, { label: 'a', caption: 'After dark.' })
    const bare = seoFor({ route: 'tag', tagSlug: 'a' }, { label: 'a', caption: null })
    expect(captioned.description).toBe('After dark.')
    expect(bare.description).toBe(`Photographs tagged a on ${SITE.name}.`)
  })

  it('keeps a long caption to what a search result shows', () => {
    const seo = seoFor({ route: 'tag', tagSlug: 'a' }, { label: 'a', caption: 'x'.repeat(400) })
    expect(seo.description).toHaveLength(160)
    expect(seo.description.endsWith('…')).toBe(true)
  })
})

describe('words the operator wrote', () => {
  const hostile = { label: '"><script>alert(1)</script>', caption: 'a & b "quoted" </script>' }

  it('cannot break out of an attribute or out of the JSON-LD script', () => {
    const markup = headTags(seoFor({ route: 'tag', tagSlug: 'x' }, hostile))
    // One script element, the JSON-LD's own: a `</script>` in a caption would
    // have closed it early and let the rest run as markup.
    expect(markup.match(/<script/g)).toHaveLength(1)
    expect(markup.match(/<\/script>/g)).toHaveLength(1)
    expect(markup).not.toContain('"><script>')
    expect(markup).toContain('content="a &amp; b &quot;quoted&quot; &lt;/script&gt;"')
  })

  it('survives a round trip through the JSON-LD', () => {
    const graph = jsonLdOf(headTags(seoFor({ route: 'tag', tagSlug: 'x' }, hostile)))['@graph']
    const page = graph.find((node) => node['@type'] === 'CollectionPage')
    expect(page?.['description']).toBe(hostile.caption)
  })
})

describe('the structured data', () => {
  it('names the photographer once and points each page at it by id', () => {
    const graph = jsonLdOf(headTags(seoFor({ route: 'about' }, null)))['@graph']
    const people = graph.filter((node) => node['@type'] === 'Person')
    expect(people).toHaveLength(1)
    const about = graph.find((node) => node['@type'] === 'AboutPage')
    expect(about?.['mainEntity']).toEqual({ '@id': people[0]?.['@id'] })
  })

  it('puts a Tag page under the home page in its breadcrumb', () => {
    const graph = jsonLdOf(
      headTags(seoFor({ route: 'tag', tagSlug: 'night' }, { label: 'night', caption: null })),
    )['@graph']
    const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList')
    expect(crumbs?.['itemListElement']).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
      { '@type': 'ListItem', position: 2, name: 'night', item: `${SITE.url}/tag/night` },
    ])
  })
})

describe('injecting into the template', () => {
  it('puts the tags last in the head and leaves the title for Foldkit', () => {
    const template = '<html><head><title>x</title></head><body></body></html>'
    const out = injectHead(template, '<meta name="a" />')
    expect(out.indexOf('<meta name="a" />')).toBeGreaterThan(out.indexOf('<title>x</title>'))
    expect(out.indexOf('<meta name="a" />')).toBeLessThan(out.indexOf('</head>'))
    expect(out.match(/<title>/g)).toHaveLength(1)
  })

  it('leaves a document with no head alone rather than writing tags into the body', () => {
    const template = '<div id="root"></div>'
    expect(injectHead(template, '<meta name="a" />')).toBe(template)
  })
})
