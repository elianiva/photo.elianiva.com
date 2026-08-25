import { Schema as S } from 'effect'

// ---------------------------------------------------------------------------
// Photo — curated work (see CONTEXT.md). Mock shape for scaffold; fields
// will be refined when the CMS (Sanity/Directus/R2+Images) is wired.
// ---------------------------------------------------------------------------

export const PhotoId = S.String.pipe(S.brand('PhotoId'))
export type PhotoId = typeof PhotoId.Type

export const CollectionId = S.String.pipe(S.brand('CollectionId'))
export type CollectionId = typeof CollectionId.Type

export const Photo = S.Struct({
  id: PhotoId,
  slug: S.String,
  title: S.String,
  caption: S.optional(S.String),
  collectionId: CollectionId,
  // CDN URL for the image — when R2+Images lands this becomes a cf-transform URL.
  imageUrl: S.String,
  takenAt: S.optional(S.String),
  location: S.optional(S.String),
})
export type Photo = typeof Photo.Type

export const Collection = S.Struct({
  id: CollectionId,
  slug: S.String,
  title: S.String,
  description: S.optional(S.String),
  coverPhotoId: S.optional(PhotoId),
})
export type Collection = typeof Collection.Type

const decodeCollectionId = S.decodeSync(CollectionId)
const decodePhotoId = S.decodeSync(PhotoId)

// Mock data — replaced by CMS fetch in the next iteration.
export const mockCollections: ReadonlyArray<Collection> = [
  {
    id: decodeCollectionId('col-1'),
    slug: 'kyoto-2024',
    title: 'Kyoto 2024',
    description: 'Winter light in Kyoto.',
  },
  {
    id: decodeCollectionId('col-2'),
    slug: 'bali-2023',
    title: 'Bali 2023',
    description: 'Coast and jungle.',
  },
]

export const mockPhotos: ReadonlyArray<Photo> = [
  {
    id: decodePhotoId('photo-1'),
    slug: 'kyoto-garden',
    title: 'Kyoto Garden',
    collectionId: decodeCollectionId('col-1'),
    imageUrl: 'https://picsum.photos/seed/kyoto1/800/600',
  },
  {
    id: decodePhotoId('photo-2'),
    slug: 'bali-sunset',
    title: 'Bali Sunset',
    collectionId: decodeCollectionId('col-2'),
    imageUrl: 'https://picsum.photos/seed/bali1/800/600',
  },
]
