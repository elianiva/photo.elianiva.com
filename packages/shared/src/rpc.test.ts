import { describe, expect, it } from 'vitest'
import { Schema as S } from 'effect'
import { PhotoWithTags, Tag } from './photo'

describe('shared schemas', () => {
  it('decodes PhotoWithTags with optional fields', () => {
    const raw = {
      id: 'photo_1',
      slug: 'seed-photo-01',
      title: 'Seed Photo 01',
      r2Key: 'originals/photo_1-seed-photo-01.jpg',
      width: 1200,
      height: 800,
      takenAt: '2024-01-15',
      metadata: { caption: 'hello' },
      tags: [{ id: 'tag_kyoto', slug: 'kyoto', label: 'Kyoto', caption: null }],
    }
    const decoded = S.decodeSync(PhotoWithTags)(raw)
    expect(decoded.slug).toBe('seed-photo-01')
    expect(decoded.tags?.[0]?.label).toBe('Kyoto')
  })

  it('decodes Tag', () => {
    const tag = S.decodeSync(Tag)({ id: 'tag_1', slug: 'kyoto', label: 'Kyoto', caption: null })
    expect(tag.slug).toBe('kyoto')
  })

  it('PhotoWithTags optional takenAt', () => {
    const raw = {
      id: 'photo_2',
      slug: 'no-date',
      title: 'No Date',
      r2Key: 'originals/no-date.jpg',
      width: 100,
      height: 100,
      metadata: {},
      tags: [],
    }
    const decoded = S.decodeSync(PhotoWithTags)(raw)
    expect(decoded.takenAt).toBeUndefined()
  })
})
