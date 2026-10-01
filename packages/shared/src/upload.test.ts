import { describe, expect, it } from 'vitest'
import { Option, Schema as S } from 'effect'
import { Blurhash, TagIdList, isUploadError } from './upload'

/** A hash the browser's encoder actually produces, from the real alphabet. */
const VALID_HASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

describe('Blurhash', () => {
  it('accepts a real encoder hash', () => {
    expect(S.decodeSync(Blurhash)(VALID_HASH)).toBe(VALID_HASH)
  })

  it('accepts every character of the base83 alphabet', () => {
    // One character at a time: the alphabet is 83 symbols, which is over the
    // 64-character bound, so the whole string is not itself a decodable hash.
    const alphabet =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'
    expect(alphabet).toHaveLength(83)
    for (const char of alphabet) {
      // Padded to the 6-character minimum with the candidate inside, so the
      // assertion is about the alphabet and not about the length bound.
      const candidate = `LL${char}LLL`
      expect(candidate).toHaveLength(6)
      expect(S.decodeUnknownOption(Blurhash)(candidate)).not.toStrictEqual(Option.none())
    }
  })

  it('rejects a hash outside the alphabet', () => {
    // The one character the encoder can never emit: a space, which is what a
    // hand-edited field tends to carry instead.
    expect(S.decodeUnknownOption(Blurhash)('L EHV6nWB2yk8')).toStrictEqual(Option.none())
  })

  it('rejects a hash below the minimum length', () => {
    expect(S.decodeUnknownOption(Blurhash)('L')).toStrictEqual(Option.none())
  })

  it('rejects a hash above the maximum length', () => {
    expect(S.decodeUnknownOption(Blurhash)('L'.repeat(65))).toStrictEqual(Option.none())
  })

  it('accepts the exact length bounds', () => {
    expect(S.decodeUnknownOption(Blurhash)('L'.repeat(6))).not.toStrictEqual(Option.none())
    expect(S.decodeUnknownOption(Blurhash)('L'.repeat(64))).not.toStrictEqual(Option.none())
  })
})

describe('TagIdList', () => {
  it('accepts a list of tag ids', () => {
    expect(S.decodeSync(TagIdList)(['tag_kyoto', 'tag_film'])).toStrictEqual([
      'tag_kyoto',
      'tag_film',
    ])
  })

  it('accepts an empty list', () => {
    expect(S.decodeSync(TagIdList)([])).toStrictEqual([])
  })

  it('rejects a list over the 32-tag bound', () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `tag_${String(i)}`)
    expect(S.decodeUnknownOption(TagIdList)(tooMany)).toStrictEqual(Option.none())
  })

  it('accepts exactly 32 tags', () => {
    const exact = Array.from({ length: 32 }, (_, i) => `tag_${String(i)}`)
    expect(S.decodeUnknownOption(TagIdList)(exact)).not.toStrictEqual(Option.none())
  })

  it('rejects a non-string entry', () => {
    expect(S.decodeUnknownOption(TagIdList)(['tag_kyoto', 7])).toStrictEqual(Option.none())
  })
})

describe('the upload response union', () => {
  const decode = S.decodeUnknownOption(
    S.Union([
      S.Struct({ id: S.String, slug: S.String, r2Key: S.String, renditionsPending: S.Boolean }),
      S.Struct({ message: S.String }),
    ]),
  )

  it('reads a stored Photo, and reports whether a Rendition is owed', () => {
    const decoded = Option.getOrThrow(
      decode({
        id: 'photo_1',
        slug: 'kyoto-rain',
        r2Key: 'originals/photo_1-kyoto-rain.jpg',
        renditionsPending: true,
      }),
    )
    expect(isUploadError(decoded)).toBe(false)
  })

  it('reads a rejection as the error side of the union', () => {
    const decoded = Option.getOrThrow(decode({ message: 'unsupported image — JPEG only' }))
    expect(isUploadError(decoded)).toBe(true)
  })

  it('rejects a success body missing renditionsPending', () => {
    // The field is required on purpose: a client that had to guess whether the
    // Worker sends it is a client whose guess is wrong the day it first does.
    expect(decode({ id: 'photo_1', slug: 's', r2Key: 'k' })).toStrictEqual(Option.none())
  })

  it('rejects a body that is neither shape', () => {
    expect(decode({ unexpected: true })).toStrictEqual(Option.none())
  })
})
