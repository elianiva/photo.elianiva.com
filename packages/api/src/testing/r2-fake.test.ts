import { describe, expect, it } from 'vitest'
import type { R2BucketLike } from '../gateway'
import { makeR2Fake } from './r2-fake'

const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43])

const store = async (
  bucket: R2BucketLike,
  key: string,
  bytes: Uint8Array = JPEG_BYTES,
): Promise<void> => {
  await bucket.put(key, new Uint8Array(bytes).buffer, {
    httpMetadata: { contentType: 'image/jpeg' },
  })
}

describe('R2 fake', () => {
  it('returns the stored bytes and content type on get', async () => {
    const bucket = makeR2Fake()
    await store(bucket, 'originals/a.jpg')

    const object = await bucket.get('originals/a.jpg')
    expect(object?.key).toBe('originals/a.jpg')
    expect(object?.size).toBe(JPEG_BYTES.byteLength)
    expect(object?.httpMetadata?.contentType).toBe('image/jpeg')
    expect(new Uint8Array(await new Response(object!.body!).arrayBuffer())).toEqual(JPEG_BYTES)
  })

  it('returns null for a missing key on get and head', async () => {
    const bucket = makeR2Fake()
    expect(await bucket.get('originals/nope.jpg')).toBeNull()
    expect(await bucket.head('originals/nope.jpg')).toBeNull()
  })

  it('head reports the byte count without a body', async () => {
    const bucket = makeR2Fake()
    await store(bucket, 'originals/a.jpg')

    const object = await bucket.head('originals/a.jpg')
    expect(object?.size).toBe(JPEG_BYTES.byteLength)
    expect(object?.body).toBeNull()
    expect(object?.uploaded).toBeInstanceOf(Date)
  })

  it('accepts string and stream bodies', async () => {
    const bucket = makeR2Fake()
    await bucket.put('notes/readme.txt', 'hello')
    await bucket.put('stream.bin', new Response(Uint8Array.from([1, 2, 3])).body!)

    expect((await bucket.head('notes/readme.txt'))?.size).toBe(5)
    expect((await bucket.head('stream.bin'))?.size).toBe(3)
  })

  it('delete removes the object and is a no-op for a missing key', async () => {
    const bucket = makeR2Fake()
    await store(bucket, 'originals/a.jpg')

    await bucket.delete('originals/a.jpg')
    expect(await bucket.get('originals/a.jpg')).toBeNull()
    await expect(bucket.delete('originals/a.jpg')).resolves.toBeUndefined()
  })

  it('lists every key lexicographically', async () => {
    const bucket = makeR2Fake()
    await store(bucket, 'originals/b.jpg')
    await store(bucket, 'originals/a.jpg')
    await store(bucket, 'thumbs/a.webp')

    const listed = await bucket.list()
    expect(listed.objects.map((object) => object.key)).toEqual([
      'originals/a.jpg',
      'originals/b.jpg',
      'thumbs/a.webp',
    ])
    expect(listed.truncated).toBe(false)
  })
})
