import { describe, expect, it } from 'vitest'
import { hasWebpMagic, isServableKey, renditionKey } from './rendition'

describe('renditionKey', () => {
  it('derives both WebP keys from the Photo id', () => {
    expect(renditionKey('abc', 'small')).toBe('renditions/abc/small.webp')
    expect(renditionKey('abc', 'preview')).toBe('renditions/abc/preview.webp')
  })
})

describe('isServableKey', () => {
  it('serves originals and renditions, and nothing else', () => {
    expect(isServableKey('originals/a.jpg')).toBe(true)
    expect(isServableKey('renditions/a/small.webp')).toBe(true)
    expect(isServableKey('private/a.jpg')).toBe(false)
    expect(isServableKey('')).toBe(false)
  })
})

describe('hasWebpMagic', () => {
  const header = [0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]
  it('accepts RIFF….WEBP', () => expect(hasWebpMagic(new Uint8Array(header))).toBe(true))
  it('refuses a JPEG, a PNG and a short buffer', () => {
    expect(hasWebpMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      false,
    )
    expect(hasWebpMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(hasWebpMagic(new Uint8Array(header.slice(0, 8)))).toBe(false)
  })
})
