import { describe, expect, it } from 'vitest'
import { TagId, type Tag } from '@photo/shared'
import { activeTagIds } from './helpers'

const tag = (id: string, slug: string, label: string): Tag => ({
  id: TagId.make(id),
  slug,
  label,
  caption: null,
})

const istanbul = tag('tag_istanbul', 'istanbul', 'Istanbul')
const kyoto = tag('tag_kyoto', 'kyoto', 'Kyoto')

describe('activeTagIds', () => {
  it('is no filter when the Library is unfiltered', () => {
    expect(activeTagIds({ tags: [istanbul, kyoto] })).toEqual([])
  })

  it('resolves the active slug to the id the Photos table is keyed on', () => {
    // The Model carries a slug because the chip row and the URL do; the wire
    // carries an id because `photo_tags` does. Getting this wrong filters by
    // nothing and silently shows the whole Library.
    expect(activeTagIds({ tags: [istanbul, kyoto], activeTagSlug: 'kyoto' })).toEqual([kyoto.id])
  })

  it('is no filter for a slug no Tag in the Model carries', () => {
    // The delete fold clears `activeTagSlug` before asking for a refetch, so
    // this is the state a caller only reaches by reaching past the Model.
    expect(activeTagIds({ tags: [istanbul], activeTagSlug: 'kyoto' })).toEqual([])
  })
})
