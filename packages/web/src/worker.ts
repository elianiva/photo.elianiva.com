import { Effect, Schema as S } from 'effect'
import type { WebsiteEnv } from '../../../alchemy.run'
import {
  CreateTagRequest,
  DbPhotoRow,
  DbTagRow,
  D1AllResultPhoto,
  D1AllResultTag,
  PhotoWithTags,
  Tag,
  UpdatePhotoRequest,
} from '@photo/shared'

type WorkerEnvWithAssets = WebsiteEnv & {
  ASSETS: { fetch: typeof fetch }
}

// ---------------------------------------------------------------------------
// Domain errors — idiomatic Effect TaggedErrors
// ---------------------------------------------------------------------------

export class DbError extends S.TaggedError<DbError>()('DbError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

export class R2Error extends S.TaggedError<R2Error>()('R2Error', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

export class ValidationError extends S.TaggedError<ValidationError>()('ValidationError', {
  message: S.String,
  cause: S.optional(S.Unknown),
}) {}

export class NotFound extends S.TaggedError<NotFound>()('NotFound', {
  message: S.String,
}) {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled'

const extFromName = (name: string): string => {
  const parts = name.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : 'jpg'
  if (['jpg', 'jpeg', 'webp', 'png', 'avif', 'heic', 'heif'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext
  }
  return 'jpg'
}

const jsonResponse = (data: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    ...init,
  })

const parseMetadata = (raw: string | null): string => {
  if (!raw) return '{}'
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') return raw
    return JSON.stringify(parsed)
  } catch {
    return raw
  }
}

const parseMetadataObject = (raw: string | null): Record<string, unknown> | undefined => {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return undefined
  }
}

const getFormString = (form: FormData, key: string): string | null => {
  const value = form.get(key)
  if (typeof value === 'string') return value
  return null
}

const getFormFile = (form: FormData, key: string): File | null => {
  const value = form.get(key)
  return value instanceof File ? value : null
}

// ---------------------------------------------------------------------------
// DB helpers — Effect-wrapped with Schema validation at boundaries
// ---------------------------------------------------------------------------

const listPhotosEffect = (env: WebsiteEnv) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => env.DB.prepare(`SELECT id, slug, title, r2Key, width, height, takenAt, metadata FROM photos ORDER BY takenAt DESC, rowid DESC`).all(),
      catch: (cause) => new DbError({ message: 'Failed to list photos', cause }),
    })
    const decoded = yield* S.decodeUnknownEffect(D1AllResultPhoto)(raw).pipe(
      Effect.mapError((cause) => new DbError({ message: 'Invalid photo rows', cause })),
    )
    const rows = decoded.results ?? []
    const photos = yield* Effect.all(
      rows.map((row) =>
        Effect.gen(function* () {
          const tagRaw = yield* Effect.tryPromise({
            try: () =>
              env.DB.prepare(`SELECT t.id, t.slug, t.label FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE pt.photoId = ? ORDER BY t.label`)
                .bind(row.id)
                .all(),
            catch: (cause) => new DbError({ message: 'Failed to load tags for photo', cause }),
          })
          const tagDecoded = yield* S.decodeUnknownEffect(D1AllResultTag)(tagRaw).pipe(
            Effect.mapError((cause) => new DbError({ message: 'Invalid tag rows', cause })),
          )
          const photoWithTags: typeof PhotoWithTags.Type = {
            id: row.id,
            slug: row.slug,
            title: row.title,
            r2Key: row.r2Key,
            width: row.width,
            height: row.height,
            takenAt: row.takenAt ?? undefined,
            metadata: parseMetadataObject(row.metadata),
            tags: tagDecoded.results ?? [],
          }
          // Validate against shared schema before returning
          yield* S.decodeUnknownEffect(PhotoWithTags)(photoWithTags).pipe(
            Effect.mapError((cause) => new DbError({ message: 'PhotoWithTags validation failed', cause })),
          )
          return photoWithTags
        }),
      ),
    )
    return jsonResponse(photos)
  })

const listTagsEffect = (env: WebsiteEnv) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => env.DB.prepare(`SELECT id, slug, label FROM tags ORDER BY label`).all(),
      catch: (cause) => new DbError({ message: 'Failed to list tags', cause }),
    })
    const decoded = yield* S.decodeUnknownEffect(D1AllResultTag)(raw).pipe(
      Effect.mapError((cause) => new DbError({ message: 'Invalid tag rows', cause })),
    )
    const tags = decoded.results ?? []
    // Validate each tag via shared schema
    yield* Effect.all(tags.map((tag) => S.decodeUnknownEffect(Tag)(tag).pipe(Effect.mapError((cause) => new DbError({ message: 'Tag validation failed', cause })))))
    return jsonResponse(tags)
  })

const getPhotoEffect = (env: WebsiteEnv, id: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => env.DB.prepare(`SELECT id, slug, title, r2Key, width, height, takenAt, metadata FROM photos WHERE id = ?`).bind(id).first(),
      catch: (cause) => new DbError({ message: 'Failed to get photo', cause }),
    })
    if (!raw) return yield* Effect.fail(new NotFound({ message: `Photo ${id} not found` }))
    const row = yield* S.decodeUnknownEffect(DbPhotoRow)(raw).pipe(
      Effect.mapError((cause) => new DbError({ message: 'Invalid photo row', cause })),
    )
    const tagRaw = yield* Effect.tryPromise({
      try: () =>
        env.DB.prepare(`SELECT t.id, t.slug, t.label FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE pt.photoId = ?`)
          .bind(row.id)
          .all(),
      catch: (cause) => new DbError({ message: 'Failed to load photo tags', cause }),
    })
    const tagDecoded = yield* S.decodeUnknownEffect(D1AllResultTag)(tagRaw).pipe(
      Effect.mapError((cause) => new DbError({ message: 'Invalid tag rows', cause })),
    )
    const photoWithTags: typeof PhotoWithTags.Type = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      r2Key: row.r2Key,
      width: row.width,
      height: row.height,
      takenAt: row.takenAt ?? undefined,
      metadata: parseMetadataObject(row.metadata),
      tags: tagDecoded.results ?? [],
    }
    yield* S.decodeUnknownEffect(PhotoWithTags)(photoWithTags).pipe(
      Effect.mapError((cause) => new DbError({ message: 'PhotoWithTags validation failed', cause })),
    )
    return jsonResponse(photoWithTags)
  })

const deletePhotoEffect = (env: WebsiteEnv, id: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.tryPromise({
      try: () => env.DB.prepare(`SELECT r2Key FROM photos WHERE id = ?`).bind(id).first(),
      catch: (cause) => new DbError({ message: 'Failed to fetch photo for delete', cause }),
    })
    if (!raw) return yield* Effect.fail(new NotFound({ message: `Photo ${id} not found` }))
    const row = yield* S.decodeUnknownEffect(S.Struct({ r2Key: S.String }))(raw).pipe(
      Effect.mapError((cause) => new DbError({ message: 'Invalid r2Key row', cause })),
    )
    yield* Effect.tryPromise({
      try: () => env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(id).run(),
      catch: (cause) => new DbError({ message: 'Failed to delete photo', cause }),
    })
    yield* Effect.tryPromise({
      try: () => env.PHOTOS.delete(row.r2Key),
      catch: (cause) => new DbError({ message: 'R2 delete ignored', cause }),
    }).pipe(Effect.orElseSucceed(() => undefined))
    return jsonResponse({ ok: true })
  })

const createTagEffect = (env: WebsiteEnv, body: unknown) =>
  Effect.gen(function* () {
    const parsed = yield* S.decodeUnknownEffect(CreateTagRequest)(body).pipe(
      Effect.mapError((cause) => new ValidationError({ message: 'Invalid tag body', cause })),
    )
    const id = crypto.randomUUID()
    const slug = slugify(parsed.slug)
    yield* Effect.tryPromise({
      try: () => env.DB.prepare(`INSERT INTO tags (id, slug, label) VALUES (?, ?, ?)`).bind(id, slug, parsed.label).run(),
      catch: (cause) => new DbError({ message: `Tag slug "${slug}" already exists`, cause }),
    })
    const created: typeof Tag.Type = { id: id as typeof Tag.Type extends { id: infer I } ? I : never, slug, label: parsed.label }
    yield* S.decodeUnknownEffect(Tag)(created).pipe(Effect.mapError((cause) => new DbError({ message: 'Tag validation failed', cause })))
    return jsonResponse(created, { status: 201 })
  })

const deleteTagEffect = (env: WebsiteEnv, id: string) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => env.DB.prepare(`DELETE FROM tags WHERE id = ?`).bind(id).run(),
      catch: (cause) => new DbError({ message: 'Failed to delete tag', cause }),
    })
    return jsonResponse({ ok: true })
  })

const handleGet = (request: Request, env: WebsiteEnv): Effect.Effect<Response, DbError | NotFound | R2Error> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (url.pathname === '/api/photos') return yield* listPhotosEffect(env)
    if (url.pathname === '/api/tags') return yield* listTagsEffect(env)
    const photoMatch = url.pathname.match(/^\/api\/photos\/([^/]+)$/)
    if (photoMatch) {
      const photoId = photoMatch[1]
      if (!photoId) return yield* Effect.fail(new NotFound({ message: 'Missing photo id' }))
      return yield* getPhotoEffect(env, photoId)
    }
    if (url.pathname.startsWith('/api/image/')) {
      const r2Key = decodeURIComponent(url.pathname.slice('/api/image/'.length))
      const obj = yield* Effect.tryPromise({
        try: () => env.PHOTOS.get(r2Key) as Promise<{ httpMetadata?: { contentType?: string }; body: ReadableStream | null } | null>,
        catch: (cause) => new R2Error({ message: `Failed to fetch R2 object ${r2Key}`, cause }),
      })
      if (!obj) return yield* Effect.fail(new NotFound({ message: `Image ${r2Key} not found` }))
      const headers = new Headers()
      headers.set('content-type', obj.httpMetadata?.contentType ?? 'image/jpeg')
      headers.set('cache-control', 'public, max-age=31536000, immutable')
      return new Response(obj.body as BodyInit | null, { headers })
    }
    return yield* Effect.fail(new NotFound({ message: `GET ${url.pathname} not found` }))
  })

const handlePost = (request: Request, env: WebsiteEnv): Effect.Effect<Response, DbError | R2Error | ValidationError | NotFound> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (url.pathname === '/api/photos') {
      const form: FormData = yield* Effect.tryPromise({
        try: () => request.formData(),
        catch: (cause) => new ValidationError({ message: 'Invalid multipart form', cause }),
      })
      const file = getFormFile(form, 'file')
      const title = getFormString(form, 'title')?.trim() ?? null
      const slugRaw = getFormString(form, 'slug')?.trim() ?? ''
      const takenAt = getFormString(form, 'takenAt')?.trim() || null
      const widthRaw = getFormString(form, 'width')
      const heightRaw = getFormString(form, 'height')
      const metadataRaw = getFormString(form, 'metadata')
      const tagIdsRaw = getFormString(form, 'tagIds')

      if (!file || !title) return yield* Effect.fail(new ValidationError({ message: 'file and title are required' }))
      const width = widthRaw ? Number(widthRaw) : Number.NaN
      const height = heightRaw ? Number(heightRaw) : Number.NaN
      if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return yield* Effect.fail(new ValidationError({ message: 'width and height are required' }))
      }
      const id = crypto.randomUUID()
      const finalSlug = slugRaw ? slugify(slugRaw) : slugify(title)
      const existing = yield* Effect.tryPromise({
        try: () => env.DB.prepare(`SELECT id FROM photos WHERE slug = ?`).bind(finalSlug).first<{ id: string }>(),
        catch: (cause) => new DbError({ message: 'Failed to check slug uniqueness', cause }),
      })
      const slugToUse = existing ? `${finalSlug}-${id.slice(0, 8)}` : finalSlug
      const ext = extFromName(file.name || 'photo.jpg')
      const r2Key = `originals/${id}-${slugToUse}.${ext}`
      const metadataJson = parseMetadata(metadataRaw)

      const buf: ArrayBuffer = yield* Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (cause) => new ValidationError({ message: 'Failed to read uploaded file', cause }),
      })
      yield* Effect.tryPromise({
        try: () => env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'image/jpeg' } }),
        catch: (cause) => new R2Error({ message: 'Failed to store image in R2', cause }),
      })
      const photoRow: typeof DbPhotoRow.Type = {
        id: id as typeof DbPhotoRow.Type extends { id: infer I } ? I : never,
        slug: slugToUse,
        title,
        r2Key,
        width,
        height,
        takenAt,
        metadata: metadataJson,
      }
      yield* S.decodeUnknownEffect(DbPhotoRow)(photoRow).pipe(
        Effect.mapError((cause) => new ValidationError({ message: 'Photo row validation failed', cause })),
      )
      yield* Effect.tryPromise({
        try: () =>
          env.DB.prepare(`INSERT INTO photos (id, slug, title, r2Key, width, height, takenAt, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(photoRow.id, photoRow.slug, photoRow.title, photoRow.r2Key, photoRow.width, photoRow.height, photoRow.takenAt, photoRow.metadata)
            .run(),
        catch: (cause) => new DbError({ message: 'Failed to insert photo', cause }),
      })
      const TagIdsSchema = S.Array(S.String)
      let tagIds: ReadonlyArray<string> = []
      if (tagIdsRaw) {
        const parsedRaw: unknown = yield* Effect.try({
          try: (): unknown => JSON.parse(tagIdsRaw),
          catch: (cause) => new ValidationError({ message: 'Invalid tagIds JSON', cause }),
        }).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
        const decoded = yield* S.decodeUnknownEffect(TagIdsSchema)(parsedRaw).pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>))
        tagIds = decoded
      }
      if (tagIds.length === 0) {
        const repeated = form.getAll('tagIds[]').filter((v): v is string => typeof v === 'string')
        if (repeated.length) tagIds = repeated
      }
      for (const tagId of tagIds) {
        const decodedTagId = yield* S.decodeUnknownEffect(S.String)(tagId).pipe(
          Effect.mapError((cause) => new ValidationError({ message: `Invalid tagId ${tagId}`, cause })),
        )
        yield* Effect.tryPromise({
          try: () => env.DB.prepare(`INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (?, ?)`).bind(id, decodedTagId).run(),
          catch: (cause) => new DbError({ message: `Failed to link tag ${decodedTagId}`, cause }),
        })
      }
      return jsonResponse({ id, slug: slugToUse, r2Key }, { status: 201 })
    }
    if (url.pathname === '/api/tags') {
      const body: unknown = yield* Effect.tryPromise({
        try: () => request.json() as Promise<unknown>,
        catch: (cause) => new ValidationError({ message: 'Invalid JSON body', cause }),
      })
      return yield* createTagEffect(env, body)
    }
    return yield* Effect.fail(new NotFound({ message: `POST ${url.pathname} not found` }))
  })

const handlePatch = (request: Request, env: WebsiteEnv): Effect.Effect<Response, DbError | ValidationError | NotFound> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    if (!url.pathname.match(/^\/api\/photos\/[^/]+$/)) return yield* Effect.fail(new NotFound({ message: `PATCH ${url.pathname} not found` }))
    const segments = url.pathname.split('/')
    const id = segments[segments.length - 1]
    if (!id) return yield* Effect.fail(new ValidationError({ message: 'Missing photo id' }))
    const body: unknown = yield* Effect.tryPromise({
      try: () => request.json() as Promise<unknown>,
      catch: (cause) => new ValidationError({ message: 'Invalid JSON', cause }),
    })
    const parsed = yield* S.decodeUnknownEffect(UpdatePhotoRequest)(body).pipe(
      Effect.mapError((cause) => new ValidationError({ message: 'Invalid patch body', cause })),
    )
    const fields: Array<string> = []
    const binds: Array<unknown> = []
    if (parsed.title !== undefined) {
      fields.push('title = ?')
      binds.push(parsed.title)
    }
    if (parsed.slug !== undefined) {
      fields.push('slug = ?')
      binds.push(slugify(parsed.slug))
    }
    if (parsed.takenAt !== undefined) {
      fields.push('takenAt = ?')
      binds.push(parsed.takenAt)
    }
    if (parsed.metadata !== undefined) {
      fields.push('metadata = ?')
      binds.push(JSON.stringify(parsed.metadata))
    }
    if (fields.length) {
      const sql = `UPDATE photos SET ${fields.join(', ')} WHERE id = ?`
      binds.push(id)
      const BindSchema = S.Array(S.Unknown)
      const decodedBinds = yield* S.decodeUnknownEffect(BindSchema)(binds).pipe(
        Effect.mapError((cause) => new ValidationError({ message: 'Invalid binds', cause })),
      )
      yield* Effect.tryPromise({
        try: () => env.DB.prepare(sql).bind(...(decodedBinds as Array<string>)).run(),
        catch: (cause) => new DbError({ message: 'Failed to update photo', cause }),
      })
    }
    if (parsed.tagIds !== undefined) {
      yield* Effect.tryPromise({
        try: () => env.DB.prepare(`DELETE FROM photo_tags WHERE photoId = ?`).bind(id).run(),
        catch: (cause) => new DbError({ message: 'Failed to reset tags', cause }),
      })
      for (const tagId of parsed.tagIds) {
        const decodedTagId = yield* S.decodeUnknownEffect(S.String)(tagId).pipe(
          Effect.mapError((cause) => new ValidationError({ message: `Invalid tagId ${tagId}`, cause })),
        )
        yield* Effect.tryPromise({
          try: () => env.DB.prepare(`INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (?, ?)`).bind(id, decodedTagId).run(),
          catch: (cause) => new DbError({ message: `Failed to link tag ${decodedTagId}`, cause }),
        })
      }
    }
    return jsonResponse({ ok: true })
  })

const handleDelete = (request: Request, env: WebsiteEnv): Effect.Effect<Response, DbError | NotFound> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const photoMatch = url.pathname.match(/^\/api\/photos\/([^/]+)$/)
    if (photoMatch) {
      const photoId = photoMatch[1]
      if (!photoId) return yield* Effect.fail(new NotFound({ message: 'Missing photo id' }))
      return yield* deletePhotoEffect(env, photoId)
    }
    const tagMatch = url.pathname.match(/^\/api\/tags\/([^/]+)$/)
    if (tagMatch) {
      const tagId = tagMatch[1]
      if (!tagId) return yield* Effect.fail(new NotFound({ message: 'Missing tag id' }))
      return yield* deleteTagEffect(env, tagId)
    }
    return yield* Effect.fail(new NotFound({ message: `DELETE ${url.pathname} not found` }))
  })

// ---------------------------------------------------------------------------
// Admin HTML — served at /admin (Access-gated)
// ---------------------------------------------------------------------------

const adminHtml = (): Response => {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Admin — photo.elianiva.com</title>
<style>
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,sans-serif}
body{margin:0;background:#fafaf9;color:#1c1917;line-height:1.5}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e7e5e4;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;z-index:10}
header h1{font-size:16px;font-weight:600;margin:0}
header a{font-size:13px;color:#57534e;text-decoration:none}
main{max-width:1100px;margin:0 auto;padding:24px 20px}
section{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:16px 16px 20px;margin-bottom:20px}
section h2{font-size:14px;font-weight:600;margin:0 0 12px}
label{font-size:12px;font-weight:500;color:#57534e;display:block;margin-top:8px}
input,textarea,select{width:100%;padding:8px 10px;border:1px solid #d6d3d1;border-radius:8px;font-size:13px;margin-top:4px;background:#fff}
button{padding:8px 14px;border-radius:9999px;border:1px solid #1c1917;background:#1c1917;color:#fff;font-size:13px;font-weight:500;cursor:pointer}
button.secondary{background:#fff;color:#1c1917}
button:disabled{opacity:.5;cursor:not-allowed}
.grid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); gap:12px}
.card{border:1px solid #e7e5e4;border-radius:10px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.card img{width:100%;height:160px;object-fit:cover;background:#f5f5f4}
.card .meta{padding:10px 10px 12px}
.card .meta h3{font-size:13px;font-weight:600;margin:0 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .meta p{font-size:11px;color:#78716c;margin:2px 0}
.badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:9999px;background:#f5f5f4;color:#57534e;margin-right:4px;margin-top:4px}
.drop{border:2px dashed #d6d3d1;border-radius:10px;padding:20px;text-align:center;color:#a8a29e;font-size:13px;background:#fff}
.drop.drag{border-color:#1c1917;color:#1c1917;background:#fafaf9}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
.tag-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid #e7e5e4;border-radius:9999px;font-size:12px;background:#fafaf9}
.tag-pill button{padding:0 4px;border:none;background:transparent;color:#a8a29e;cursor:pointer;font-size:12px}
</style>
</head>
<body>
<header><h1>photo.elianiva.com — Admin</h1><a href="/">← Public site</a></header>
<main>
  <section id="tags-sec">
    <h2>Tags</h2>
    <div id="tags-list" class="row"></div>
    <div class="row" style="margin-top:12px">
      <input id="tag-slug" placeholder="slug (e.g. kyoto)" style="max-width:200px" />
      <input id="tag-label" placeholder="label (e.g. Kyoto)" style="max-width:200px" />
      <button id="tag-create">Create tag</button>
    </div>
    <p id="tag-msg" style="font-size:12px;color:#78716c;margin-top:8px"></p>
  </section>

  <section>
    <h2>Upload photos (bulk)</h2>
    <div id="drop" class="drop">Drag & drop images here or <label style="display:inline;color:#1c1917;text-decoration:underline;cursor:pointer"><input id="file-input" type="file" accept="image/*" multiple hidden />browse</label></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div><label>Title <span style="color:#a8a29e">(per file, defaults to filename)</span></label><input id="up-title" placeholder="Leave blank to use filename" /></div>
      <div><label>Taken at (YYYY-MM-DD)</label><input id="up-takenAt" type="date" /></div>
      <div><label>Caption</label><input id="up-caption" placeholder="Optional" /></div>
      <div><label>Location</label><input id="up-location" placeholder="Optional" /></div>
      <div><label>Camera</label><input id="up-camera" placeholder="e.g. Fujifilm X-T5" /></div>
      <div><label>Lens</label><input id="up-lens" placeholder="e.g. XF 23mm f/1.4" /></div>
    </div>
    <div id="up-tags" class="row" style="margin-top:10px"></div>
    <div class="row" style="margin-top:14px">
      <button id="up-btn">Upload selected</button>
      <span id="up-msg" style="font-size:12px;color:#78716c"></span>
    </div>
    <div id="up-que" style="margin-top:12px;font-size:12px;color:#57534e"></div>
  </section>

  <section>
    <h2>Photos — <span id="photo-count">0</span></h2>
    <div id="photos" class="grid"></div>
  </section>
</main>
<script type="module">
const $ = (s)=>document.querySelector(s);
let allTags=[]; let allPhotos=[]; let pendingFiles=[];

async function api(path, opts){ const r=await fetch(path, opts); const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t} if(!r.ok) throw new Error(j?.message||t||r.statusText); return j; }

async function loadTags(){ allTags=await api('/api/tags'); renderTags(); renderUpTags(); }
async function loadPhotos(){ allPhotos=await api('/api/photos'); renderPhotos(); }

function renderTags(){
  const el=$('#tags-list'); el.innerHTML='';
  allTags.forEach(t=>{
    const d=document.createElement('span'); d.className='tag-pill';
    d.innerHTML=\`<span>\${t.label} <small style="color:#a8a29e">(\${t.slug})</small></span>\`;
    const b=document.createElement('button'); b.textContent='×'; b.title='Delete'; b.onclick=async()=>{ if(!confirm('Delete tag '+t.label+'?'))return; await api('/api/tags/'+t.id,{method:'DELETE'}); await loadTags(); await loadPhotos();};
    d.appendChild(b); el.appendChild(d);
  });
}
function renderUpTags(){
  const el=$('#up-tags'); el.innerHTML='';
  allTags.forEach(t=>{
    const lab=document.createElement('label'); lab.style.cssText='display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer';
    lab.innerHTML=\`<input type="checkbox" value="\${t.id}" /> \${t.label}\`;
    el.appendChild(lab);
  });
}
function renderPhotos(){
  $('#photo-count').textContent=allPhotos.length;
  const el=$('#photos'); el.innerHTML='';
  allPhotos.forEach(p=>{
    const meta=p.metadata||{};
    const card=document.createElement('div'); card.className='card';
    const imgSrc='/api/image/'+encodeURIComponent(p.r2Key);
    card.innerHTML=\`
      <img src="\${imgSrc}" alt="\${p.title}" loading="lazy" />
      <div class="meta">
        <h3 title="\${p.title}">\${p.title}</h3>
        <p>\${p.slug} · \${p.width}×\${p.height} · \${p.takenAt||''}</p>
        \${meta.caption? \`<p>\${meta.caption}</p>\`:''}
        \${meta.location? \`<p>📍 \${meta.location}</p>\`:''}
        \${meta.camera? \`<p>\${meta.camera}\${meta.lens?' · '+meta.lens:''}</p>\`:''}
        <div>\${(p.tags||[]).map(t=>\`<span class="badge">\${t.label}</span>\`).join('')}</div>
      </div>\`;
    const row=document.createElement('div'); row.className='row'; row.style.padding='0 10px 10px';
    const edit=document.createElement('button'); edit.textContent='Edit'; edit.className='secondary'; edit.style.fontSize='11px'; edit.onclick=()=>openEdit(p);
    const del=document.createElement('button'); del.textContent='Delete'; del.className='secondary'; del.style.fontSize='11px'; del.onclick=async()=>{ if(!confirm('Delete '+p.title+'?'))return; await api('/api/photos/'+p.id,{method:'DELETE'}); await loadPhotos();};
    row.append(edit,del); card.appendChild(row); el.appendChild(card);
  });
}

function openEdit(p){
  const title=prompt('Title',p.title); if(title===null) return;
  const takenAt=prompt('Taken at (YYYY-MM-DD or blank)',p.takenAt||'');
  const caption=prompt('Caption',p.metadata?.caption||'');
  const location=prompt('Location',p.metadata?.location||'');
  const camera=prompt('Camera',p.metadata?.camera||'');
  const lens=prompt('Lens',p.metadata?.lens||'');
  const tagIdsStr=prompt('Tag IDs comma-separated\\nAvailable: '+allTags.map(t=>t.slug+':'+t.id).join(', '),(p.tags||[]).map(t=>t.id).join(','));
  const tagIds=tagIdsStr?tagIdsStr.split(',').map(s=>s.trim()).filter(Boolean):[];
  api('/api/photos/'+p.id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title, takenAt: takenAt||null, metadata:{caption:caption||undefined,location:location||undefined,camera:camera||undefined,lens:lens||undefined}, tagIds})}).then(loadPhotos).catch(e=>alert(e.message));
}

$('#tag-create').onclick=async()=>{
  const slug=$('#tag-slug').value.trim(); const label=$('#tag-label').value.trim(); if(!slug||!label) return alert('slug and label required');
  try{ await api('/api/tags',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({slug,label})}); $('#tag-slug').value=''; $('#tag-label').value=''; $('#tag-msg').textContent='Tag created'; await loadTags(); }catch(e){ $('#tag-msg').textContent=e.message; }
};

function setPending(files){ pendingFiles=[...files]; const q=$('#up-que'); q.innerHTML=pendingFiles.length? '<strong>'+pendingFiles.length+' files selected:</strong> '+pendingFiles.map(f=>f.name).join(', '):''; }
$('#file-input').onchange=e=> setPending(e.target.files);
const drop=$('#drop'); drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag')}); drop.addEventListener('dragleave',()=>drop.classList.remove('drag')); drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag'); setPending(e.dataTransfer.files)});

async function dimsOf(file){
  const url=URL.createObjectURL(file);
  return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>{ res({w:img.naturalWidth,h:img.naturalHeight}); URL.revokeObjectURL(url);}; img.onerror=()=>{ URL.revokeObjectURL(url); rej(new Error('cannot decode '+file.name));}; img.src=url;});
}
$('#up-btn').onclick=async()=>{
  if(!pendingFiles.length) return alert('Pick files first');
  const titleBase=$('#up-title').value.trim();
  const takenAt=$('#up-takenAt').value.trim()||undefined;
  const metadata={ caption:$('#up-caption').value.trim()||undefined, location:$('#up-location').value.trim()||undefined, camera:$('#up-camera').value.trim()||undefined, lens:$('#up-lens').value.trim()||undefined };
  const tagIds=[...document.querySelectorAll('#up-tags input:checked')].map(i=>i.value);
  const btn=$('#up-btn'); btn.disabled=true; $('#up-msg').textContent='Uploading…';
  let ok=0, fail=0;
  for(const file of pendingFiles){
    try{
      const {w,h}=await dimsOf(file);
      const title= titleBase || file.name.replace(/\\.[^/.]+$/,'');
      const fd=new FormData(); fd.set('file',file); fd.set('title',title); fd.set('width',String(w)); fd.set('height',String(h));
      if(takenAt) fd.set('takenAt',takenAt);
      const cleanMeta=Object.fromEntries(Object.entries(metadata).filter(([,v])=>v));
      if(Object.keys(cleanMeta).length) fd.set('metadata',JSON.stringify(cleanMeta));
      if(tagIds.length) fd.set('tagIds',JSON.stringify(tagIds));
      await api('/api/photos',{method:'POST',body:fd});
      ok++;
    }catch(e){ fail++; }
    $('#up-msg').textContent=\`\${ok} ok, \${fail} failed\`;
  }
  btn.disabled=false;
  await loadPhotos();
  setPending([]); $('#file-input').value='';
};

loadTags().catch(e=> $('#tag-msg').textContent=e.message);
loadPhotos().catch(()=>{});
</script>
</body>
</html>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

// ---------------------------------------------------------------------------
// Router — Effect native, exhaustive, with typed error channels
// ---------------------------------------------------------------------------

const mapErrorToResponse = (error: unknown): Response => {
  if (error instanceof NotFound) return jsonResponse({ message: error.message }, { status: 404 })
  if (error instanceof ValidationError) return jsonResponse({ message: error.message, cause: String(error.cause) }, { status: 400 })
  if (error instanceof DbError) return jsonResponse({ message: error.message, cause: String(error.cause) }, { status: 500 })
  if (error instanceof R2Error) return jsonResponse({ message: error.message, cause: String(error.cause) }, { status: 500 })
  return jsonResponse({ message: 'Internal error', cause: String(error) }, { status: 500 })
}

const handleApi = (request: Request, env: WebsiteEnv): Effect.Effect<Response, never> =>
  Effect.gen(function* () {
    const method = request.method
    if (method === 'GET') return yield* handleGet(request, env).pipe(Effect.catch((error) => Effect.succeed(mapErrorToResponse(error))))
    if (method === 'POST') return yield* handlePost(request, env).pipe(Effect.catch((error) => Effect.succeed(mapErrorToResponse(error))))
    if (method === 'PATCH') return yield* handlePatch(request, env).pipe(Effect.catch((error) => Effect.succeed(mapErrorToResponse(error))))
    if (method === 'DELETE') return yield* handleDelete(request, env).pipe(Effect.catch((error) => Effect.succeed(mapErrorToResponse(error))))
    return jsonResponse({ message: `Method ${method} not allowed` }, { status: 405 })
  })

export default {
  fetch(request: Request, env: WorkerEnvWithAssets, _ctx: unknown): Promise<Response> {
    const program = Effect.gen(function* (): Generator<Effect.Effect<Response, never, never>, Response, unknown> {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/admin')) return adminHtml()
      if (url.pathname.startsWith('/api/')) return yield* handleApi(request, env)
      if (env.ASSETS) return yield* Effect.promise<Response>(() => env.ASSETS.fetch(request))
      return new Response('Not found', { status: 404 })
    })
    return Effect.runPromise(program)
  },
}
