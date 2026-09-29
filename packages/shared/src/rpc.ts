import { Schema as S } from 'effect'
import { Rpc, RpcGroup } from 'effect/unstable/rpc'
import {
  MatColour,
  MatStyle,
  PhotoMetadata,
  PhotoPresentation,
  PhotoRatio,
  PhotoStatus,
  PhotoWithTags,
  RenditionFormat,
  Tag,
  TagId,
} from './photo'
import { PhotoIndexRow, Settings, SettingsInput, SiteSection } from './settings'

// ---------------------------------------------------------------------------
// Shared domain errors — part of the RPC contract so both sides typecheck
// against the same failure modes. StorageError covers infrastructure
// failures (D1/R2); the others are domain outcomes.
// ---------------------------------------------------------------------------

export class PhotoNotFound extends S.TaggedError<PhotoNotFound>()('PhotoNotFound', {
  id: S.String,
}) {}

export class SlugConflict extends S.TaggedError<SlugConflict>()('SlugConflict', {
  slug: S.String,
}) {}

export class InvalidInput extends S.TaggedError<InvalidInput>()('InvalidInput', {
  message: S.String,
}) {}

export class StorageError extends S.TaggedError<StorageError>()('StorageError', {
  message: S.String,
  /** Wire-safe by contract — attach through `describeCause`, never a raw
   *  error instance (the JSON codec dies on class instances). */
  cause: S.optional(S.String),
}) {}

/** D1/R2 errors are class instances the RPC JSON codec can't serialize;
 *  flatten them into a readable string before attaching to a StorageError. */
export const describeCause = (cause: unknown): string => {
  if (typeof cause === 'string') return cause
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch (parseError) {
    void parseError
    return String(cause)
  }
}

// ---------------------------------------------------------------------------
// Public reads — everything a visitor's browser or the server-rendered Front
// asks for, on the ungated `/rpc`. Nothing here can reach a Draft or a trashed
// Photo: the filter lives in `PublicPhotoService`, so it cannot be forgotten
// per handler (ADR 0010). The Admin reads the admin group instead.
// ---------------------------------------------------------------------------

export class ListPhotos extends Rpc.make('ListPhotos', {
  payload: {
    tagSlug: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    q: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    limit: S.optional(S.Number),
    cursor: S.optional(S.String.pipe(S.check(S.isMaxLength(512)))),
  },
  success: S.Struct({
    items: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
  }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

/** One Photo by id — and the one RPC both groups declare. The wire shape is the
 *  same; the answer is not. On `/rpc` the id has to name a published,
 *  non-trashed Photo or the call is `PhotoNotFound`, and on `/admin/rpc` it
 *  answers for a Draft, a failed upload or anything but the Trash, because
 *  that is the Editor's Photo. */
export class GetPhoto extends Rpc.make('GetPhoto', {
  payload: { id: S.String },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class ListTags extends Rpc.make('ListTags', {
  // Explicit empty payload: schema-less RPCs expect `null` on the wire, and
  // callers pass `{}`.
  payload: {},
  success: S.Array(Tag),
  error: StorageError,
}) {}

/** How many Edition Sections the Front's first paint renders — the design's
 *  July and August. A page-weight tradeoff, not an accident: a Section is a
 *  whole month of Photos with its Blurhash tiles, so a third one is a
 *  noticeably heavier HTML document, and the `Continued` row fetches older
 *  months on demand instead. Single-sourced here for the reason
 *  `STORAGE_CAP_BYTES` is: the contract, the service that defaults it and the
 *  call site that names it all live in this package. */
export const FRONT_SECTION_COUNT = 2

/** One Edition Section: a month of published Photos and the numbers it spans
 *  (CONTEXT.md). `year` and `label` are the Section Head's two halves —
 *  `August` over `2025` — read off the key rather than reformatted from a day,
 *  so the heading never depends on a Worker's locale or zone. */
const PublicSection = S.Struct({
  /** `2025-08`, and the cursor that resumes below it. */
  month: S.String,
  year: S.String,
  label: S.String,
  frames: S.Number,
  numberFrom: S.NullOr(S.Number),
  numberTo: S.NullOr(S.Number),
  photos: S.Array(PhotoWithTags),
})

/** The Masthead's `VOL. V — NO. 412`, the Folio's `412 FRAMES`, the lede's
 *  edition line and the Colophon's copy, in one read. `number` is the site's
 *  own counter read as the last photograph a visitor can see, so it moves back
 *  when the highest-numbered Photo is trashed (CONTEXT.md, Photo Number). */
const FrontStats = S.Struct({
  number: S.NullOr(S.Number),
  total: S.Number,
  latestTakenAt: S.NullOr(S.String),
  volume: S.String,
  motto: S.NullOr(S.String),
  siteSections: S.Array(SiteSection),
  aboutCopy: S.NullOr(S.String),
})

/** The Front's one read. The cursor is a month, not a Photo: the page walks
 *  backwards through Sections as the visitor scrolls, so `sectionCursor` is the
 *  Section to resume strictly below. `sectionCount` is optional and defaults to
 *  {@link FRONT_SECTION_COUNT}, which is also what a call site should name
 *  rather than repeat the number. */
export class GetFrontPage extends Rpc.make('GetFrontPage', {
  payload: {
    sectionCursor: S.optional(S.String.pipe(S.check(S.isMaxLength(16)))),
    sectionCount: S.optional(S.Number),
  },
  success: S.Struct({
    sections: S.Array(PublicSection),
    nextSectionCursor: S.NullOr(S.String),
    stats: FrontStats,
  }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

/** A Photo page addressed the two ways the site links to one: its slug, or the
 *  `No. 024` the design prints. Null is the answer, not an error — a slug or a
 *  number nothing published carries is a 404 the view draws, and saying so
 *  through the error channel would report a working request as a failure. */
export class GetPublicPhoto extends Rpc.make('GetPublicPhoto', {
  payload: { slug: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200))) },
  success: S.NullOr(PhotoWithTags),
  error: StorageError,
}) {}

export class GetPublicPhotoByNumber extends Rpc.make('GetPublicPhotoByNumber', {
  payload: { number: S.Number.pipe(S.check(S.isGreaterThan(0))) },
  success: S.NullOr(PhotoWithTags),
  error: StorageError,
}) {}

export const PhotoPublicRpcs = RpcGroup.make(
  ListPhotos,
  GetPhoto,
  ListTags,
  GetFrontPage,
  GetPublicPhoto,
  GetPublicPhotoByNumber,
)

// ---------------------------------------------------------------------------
// Admin writes — edge-gated (Access on photo-api /admin/*) + JWT-verified in-worker
// (ADR 0007).
// ---------------------------------------------------------------------------

export class UpdatePhoto extends Rpc.make('UpdatePhoto', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    title: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
    slug: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(200)))),
    takenAt: S.optional(S.String.pipe(S.check(S.isMaxLength(64)))),
    metadata: S.optional(PhotoMetadata),
    tagIds: S.optional(
      S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(S.check(S.isMaxLength(32))),
    ),
  },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, SlugConflict, InvalidInput, StorageError]),
}) {}

/** The Editor's loaded snapshot: one Photo's whole stored Presentation, the
 *  thing `Discard` reverts to and `Update` sends back.
 *
 *  Its own admin-group RPC rather than a wider `GetPhoto`. `GetPhoto` is
 *  declared once and served by both groups with different answers (#20), so
 *  carrying the Presentation on it would publish the authored crop, mat and
 *  export settings on the ungated `/rpc` as a side effect of the Admin needing
 *  them. The public site does not read the Presentation — it reads the
 *  Rendition it produced — so the read stays on the gated side. */
export class GetPhotoPresentation extends Rpc.make('GetPhotoPresentation', {
  payload: { id: S.String.pipe(S.check(S.isMaxLength(128))) },
  success: PhotoPresentation,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class DeletePhoto extends Rpc.make('DeletePhoto', {
  payload: { id: S.String },
  success: S.Boolean,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class CreateTag extends Rpc.make('CreateTag', {
  payload: {
    slug: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120))),
    label: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120))),
  },
  success: Tag,
  error: S.Union([SlugConflict, InvalidInput, StorageError]),
}) {}

export class DeleteTag extends Rpc.make('DeleteTag', {
  payload: { id: S.String },
  success: S.Boolean,
  error: StorageError,
}) {}

// ---------------------------------------------------------------------------
// Admin reads — what the Desk draws: who is signed in, the counts behind the
// Filter Bar, the Storage meter and the Library table.
// ---------------------------------------------------------------------------

/** Who the gate already proved, and the team that proved it. `email` and
 *  `teamDomain` are null only on the `dev` stand-down, where the gate verifies
 *  nothing because there is nothing to verify — that is not a signed-out
 *  state, and there is no sign-in form (ADR 0007, ADR 0008).
 *
 *  `teamDomain` is the verified issuer, and it is what makes the sidebar's
 *  `Sign out` a real link: the Access logout lives under it. */
export class GetSession extends Rpc.make('GetSession', {
  payload: {},
  success: S.Struct({ email: S.NullOr(S.String), teamDomain: S.NullOr(S.String) }),
  error: S.Union([StorageError]),
}) {}

/** Every stored Status, always. `scheduled` is a display label over a draft
 *  (CONTEXT.md), not a fourth value with a count.
 *
 *  `trashed` is the one count that is not over live Photos, and it is the only
 *  one that can be: the sidebar's `Trash` row carries a number, and a count
 *  taken over the same set the `total` is taken over can never report it. */
export class GetCounts extends Rpc.make('GetCounts', {
  payload: {},
  success: S.Struct({
    total: S.Number,
    trashed: S.Number,
    byStatus: S.Struct({ draft: S.Number, published: S.Number, failed: S.Number }),
    byTag: S.Array(S.Struct({ id: TagId, label: S.String, count: S.Number })),
  }),
  error: StorageError,
}) {}

/** The bucket cap, single-sourced here because the contract and every reader
 *  of it live in this package. A configured constant, not a Settings row.
 *
 *  The design disagrees with itself — the sidebar meter says `7.9 / 50 GB` and
 *  the Settings Storage block says `4.2 GB OF 20 GB` — so one number serves
 *  both, and 20 GiB is the Storage block's, which is the block that pairs the
 *  count with the byte total `GetStorageUsage` returns (ADR 0008). Change this
 *  one constant and #24's meter and #37's block follow. */
export const STORAGE_CAP_BYTES = 20 * 1024 * 1024 * 1024

export class GetStorageUsage extends Rpc.make('GetStorageUsage', {
  payload: {},
  success: S.Struct({ photos: S.Number, bytes: S.Number, capBytes: S.Number }),
  error: StorageError,
}) {}

/** The Library's sort. `takenAt` is the only sortable column the Table Head offers
 *  today (`TAKEN ↓`). The service's `PHOTO_SORT_KEYS` is the source of truth; a
 *  test runs both so the two cannot drift. */
export const LibrarySort = S.Struct({
  key: S.Literals(['takenAt']),
  direction: S.Literals(['asc', 'desc']),
})

/** The Library's one page read, plus the number the Pager prints after it:
 *  `1–7 OF 412`, where 412 is the FILTERED total — how many Photos this filter
 *  selects across the whole result set, not how many came back on this page.
 *
 *  `total` ignores the cursor: a cursor is a position in one ordering, not a
 *  filter, so the count is the same on every page of the same filter. The
 *  public `ListPhotos` is deliberately unchanged and carries no count — the
 *  Front pages by Section and never draws a filtered total, so a visitor's
 *  read pays for no COUNT. */
export class ListLibraryRows extends Rpc.make('ListLibraryRows', {
  payload: {
    status: S.optional(PhotoStatus),
    ratio: S.optional(PhotoRatio),
    tagIds: S.optional(
      S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(S.check(S.isMaxLength(32))),
    ),
    q: S.optional(S.String.pipe(S.check(S.isMaxLength(120)))),
    sort: S.optional(LibrarySort),
    cursor: S.optional(S.String.pipe(S.check(S.isMaxLength(512)))),
    limit: S.optional(S.Number),
  },
  success: S.Struct({
    items: S.Array(PhotoWithTags),
    nextCursor: S.NullOr(S.String),
    /** The filtered total, across every page, cursor ignored. */
    total: S.Number,
  }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

// ---------------------------------------------------------------------------
// Admin mutations — the Desk's single-Photo edits, its Bulk Bar and its Trash.
// ---------------------------------------------------------------------------

/** Publish and unpublish are one call: the Status is not a field on
 *  `UpdatePhoto`, and the type plus the column CHECK are both guards. */
export class SetPhotoStatus extends Rpc.make('SetPhotoStatus', {
  payload: { id: S.String.pipe(S.check(S.isMaxLength(128))), status: PhotoStatus },
  success: PhotoWithTags,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

/** A crop edit is one thing, so it is one call: the crop, the level, the mat and
 *  the export overrides ride in one request rather than six.
 *
 *  `level` and the three mat detail columns are nullable on the row, and the
 *  read model says null is un-levelled rather than zero. So a null here clears
 *  the column and an absent key leaves it alone, the way `UpdateTag`'s caption
 *  does. */
const PhotoCrop = S.Struct({
  x: S.Number,
  y: S.Number,
  scale: S.Number.pipe(S.check(S.isGreaterThan(0))),
})

const PhotoMat = S.Struct({
  enabled: S.Boolean,
  style: S.optional(S.NullOr(MatStyle)),
  colour: S.optional(S.NullOr(MatColour)),
  /** A percentage of the frame edge; the design's slider reads `4%`. */
  width: S.optional(S.NullOr(S.Number.pipe(S.check(S.isBetween({ minimum: 0, maximum: 100 }))))),
})

const PhotoExportSettings = S.Struct({
  previewLongEdge: S.optional(S.Number.pipe(S.check(S.isGreaterThan(0)))),
  previewFormat: S.optional(RenditionFormat),
  previewQuality: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 })))),
  fullQuality: S.optional(S.Number.pipe(S.check(S.isBetween({ minimum: 1, maximum: 100 })))),
  keepExif: S.optional(S.Boolean),
  removeGps: S.optional(S.Boolean),
})

export class UpdatePhotoPresentation extends Rpc.make('UpdatePhotoPresentation', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    crop: S.optional(PhotoCrop),
    level: S.optional(S.NullOr(S.Number)),
    mat: S.optional(PhotoMat),
    export: S.optional(PhotoExportSettings),
  },
  success: PhotoPresentation,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

/** The Bulk Bar is multi-select and the Trash has `Restore all`, so the
 *  lifecycle moves in arrays. These answer `void` on purpose: the fold is
 *  all-or-nothing — a Photo that must exist has to, and a Photo that must be
 *  in the Trash has to be — so a partial count cannot happen, and a count the
 *  handler read off its own payload would report nothing. The Bulk Bar knows
 *  its selection; it re-reads the list and the counts after the call. */
const PhotoIds = S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(100)),
)

export class TrashPhotos extends Rpc.make('TrashPhotos', {
  payload: { ids: PhotoIds },
  success: S.Void,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class RestorePhotos extends Rpc.make('RestorePhotos', {
  payload: { ids: PhotoIds },
  success: S.Void,
  error: S.Union([PhotoNotFound, StorageError]),
}) {}

export class PurgePhotos extends Rpc.make('PurgePhotos', {
  payload: { ids: PhotoIds },
  success: S.Void,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

const TagIds = S.Array(S.String.pipe(S.check(S.isMaxLength(128)))).pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(32)),
)

/** The Bulk Bar's `Move to series` slot, re-pointed: Series has no home
 *  (ADR 0008) and Tag is the grouping entity, so the slot is `Add tag`.
 *
 *  A Tag id nobody carries is `InvalidInput`, not a storage failure: a stale
 *  multi-select is the operator's to fix, and there is no `TagNotFound` to
 *  invent (ADR 0003 — one contract, existing errors). */
export class BulkAddTags extends Rpc.make('BulkAddTags', {
  payload: { photoIds: PhotoIds, tagIds: TagIds },
  success: S.Void,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

export class BulkRemoveTags extends Rpc.make('BulkRemoveTags', {
  payload: { photoIds: PhotoIds, tagIds: TagIds },
  success: S.Void,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

/** `Add border` is the Bulk Bar's presentation move: one mat patch, every
 *  selected Photo. */
export class AddBorderToPhotos extends Rpc.make('AddBorderToPhotos', {
  payload: { photoIds: PhotoIds, mat: PhotoMat },
  success: S.Void,
  error: S.Union([PhotoNotFound, InvalidInput, StorageError]),
}) {}

/** A Tag's `slug` is not editable: a Series page is a Tag page (ADR 0008), so
 *  a slug is a live URL and renaming one is delete + create. */
export class UpdateTag extends Rpc.make('UpdateTag', {
  payload: {
    id: S.String.pipe(S.check(S.isMaxLength(128))),
    label: S.optional(S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(120)))),
    caption: S.optional(S.NullOr(S.String.pipe(S.check(S.isMaxLength(500))))),
  },
  success: Tag,
  error: S.Union([InvalidInput, StorageError]),
}) {}

/** The Settings singleton, whole. The Desk's Settings page has no rows and no
 *  counts: it draws one form over one row, and this is that row as the wire
 *  sees it. */
export class GetSettings extends Rpc.make('GetSettings', {
  payload: {},
  success: Settings,
  error: S.Union([InvalidInput, StorageError]),
}) {}

/** One save is one call, because the row is a singleton: a half-saved Settings
 *  page is not a state anyone can describe. The answer is the stored row rather
 *  than the request echoed back, the way `setPresentation` answers, so a client
 *  never has to guess what the write actually kept. */
export class UpdateSettings extends Rpc.make('UpdateSettings', {
  payload: SettingsInput,
  success: Settings,
  error: S.Union([InvalidInput, StorageError]),
}) {}

/** Every non-trashed Photo as the Storage block's CSV index names it, in Photo
 *  Number order. The rows, not the document: the quoting, the header and the
 *  download are the page's business, and a column added to the index then costs
 *  one schema rather than a migration. */
export class ListPhotoIndex extends Rpc.make('ListPhotoIndex', {
  payload: {},
  success: S.Struct({ items: S.Array(PhotoIndexRow) }),
  error: S.Union([InvalidInput, StorageError]),
}) {}

export const PhotoAdminRpcs = RpcGroup.make(
  GetPhoto,
  GetPhotoPresentation,
  UpdatePhoto,
  DeletePhoto,
  CreateTag,
  DeleteTag,
  GetSession,
  GetCounts,
  GetStorageUsage,
  ListLibraryRows,
  SetPhotoStatus,
  UpdatePhotoPresentation,
  TrashPhotos,
  RestorePhotos,
  PurgePhotos,
  BulkAddTags,
  BulkRemoveTags,
  AddBorderToPhotos,
  UpdateTag,
  GetSettings,
  UpdateSettings,
  ListPhotoIndex,
)
