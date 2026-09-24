#!/usr/bin/env tsx
/* eslint-disable -- seed script is CLI; console output is intentional via process.stdout */
/* oxlint-disable no-console */
/**
 * Seed a fresh D1 with 8 tags + 12 placeholder photos.
 * - Dry-run (default): prints SQL to stdout.
 * - --apply: tries POST /upload against local API (photo-api.localhost).
 *
 * Usage:
 *   pnpm db:seed              # dry-run, prints SQL
 *   pnpm db:seed -- --apply   # attempt live insert via local API
 */

const tags = [
  { slug: 'kyoto', label: 'Kyoto' },
  { slug: 'film', label: 'Film' },
  { slug: 'portrait', label: 'Portrait' },
  { slug: 'landscape', label: 'Landscape' },
  { slug: 'street', label: 'Street' },
  { slug: 'night', label: 'Night' },
  { slug: 'bw', label: 'B&W' },
  { slug: 'travel', label: 'Travel' },
]

const placeholders = Array.from({ length: 12 }, (_, index) => ({
  title: `Seed Photo ${String(index + 1).padStart(2, '0')}`,
  slug: `seed-photo-${String(index + 1).padStart(2, '0')}`,
  takenAt: `2024-0${String((index % 9) + 1)}-15`,
  width: 1200 + index * 10,
  height: 800 + index * 10,
}))

const apply = process.argv.includes('--apply')

const out = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

if (!apply) {
  out('-- Seed SQL (dry-run) --')
  out(
    '-- Run with --apply to POST against https://photo-api.localhost/upload (requires pnpm dev)\n',
  )
  for (const tag of tags) {
    const id = `tag_${tag.slug}`
    out(
      `INSERT OR IGNORE INTO tags (id, slug, label) VALUES ('${id}', '${tag.slug}', '${tag.label}');`,
    )
  }
  for (const photo of placeholders) {
    const id = `photo_${photo.slug}`
    const r2Key = `originals/${id}-${photo.slug}.jpg`
    const meta = JSON.stringify({ caption: `Seed ${photo.title}` })
    out(
      `INSERT OR IGNORE INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata) VALUES ('${id}', '${photo.slug}', '${photo.title}', '${r2Key}', ${String(photo.width)}, ${String(photo.height)}, '${photo.takenAt}', '${meta}');`,
    )
  }
  out('\n-- Link first 4 photos to Kyoto + Film as example')
  for (let index = 0; index < 4; index += 1) {
    const photo = placeholders[index]!
    out(
      `INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES ('photo_${photo.slug}', 'tag_kyoto');`,
    )
    out(
      `INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES ('photo_${photo.slug}', 'tag_film');`,
    )
  }
  process.exit(0)
}

// Live apply via local API — requires dev server and a 1x1 JPEG
const tinyJpegBase64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k='
const bytes = Uint8Array.from(atob(tinyJpegBase64), (char) => char.charCodeAt(0))

for (const photo of placeholders) {
  const form = new FormData()
  form.set('file', new Blob([bytes], { type: 'image/jpeg' }), `${photo.slug}.jpg`)
  form.set('title', photo.title)
  form.set('slug', photo.slug)
  form.set('takenAt', photo.takenAt)
  form.set('tagIds', JSON.stringify(indexOfKyoto(photo) ? ['tag_kyoto', 'tag_film'] : []))

  const response = await fetch('https://photo-api.localhost/upload', {
    method: 'POST',
    body: form,
  })
  out(`${photo.slug}: ${String(response.status)} ${await response.text()}`)
}

function indexOfKyoto(photo: (typeof placeholders)[number]): boolean {
  return Number(photo.slug.split('-').at(-1)) <= 4
}
