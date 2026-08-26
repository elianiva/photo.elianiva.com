/**
 * Admin view: header (search + tag filter + Upload), masonry grid, edit
 * Sheet, upload Dialog (FileDrop + queue), confirm AlertDialog, toast stack.
 * Child submodels embed via `h.submodel` and dispatch through Got*Message.
 */

import { DateTime, Option as Opt } from 'effect'
import { inertHtml } from 'foldkit/html'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import type { PhotoWithTags, Tag } from '@photo/shared'

import { Multi } from '@foldkit/ui/combobox'

import * as Button from '@/components/ui/button'
import * as Dialog from '@/components/ui/dialog'
import * as FileDrop from '@/components/ui/file-drop'
import * as Input from '@/components/ui/input'
import * as Badge from '@/components/ui/badge'
import * as Sheet from '@/components/ui/sheet'
import * as Spinner from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { cardSizes, srcSet, thumbUrl } from '@/lib/image'

import { AdminToast, Message as M, TagMultiCombo, UPLOAD_LIMITS } from './model'
import type { Model, Msg, QueueItem } from './model'

type Child = Html | string

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------


const formatBytes = (size: number): string =>
  size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`

const formatTakenAt = (takenAt?: string): string => {
  if (takenAt === undefined || takenAt === '') return ''
  const maybe = DateTime.make(takenAt)
  if (Opt.isNone(maybe)) return takenAt
  const parts = DateTime.toPartsUtc(maybe.value)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

const labelOf = (tags: ReadonlyArray<Tag>, id: string): string =>
  tags.find((tag) => tag.id === id)?.label ?? id

// ---------------------------------------------------------------------------
// tag combobox inputs
//
// The picker's items are the known Tag ids plus, when the typed text matches
// no existing label, a `create:<label>` pseudo-item rendered inline. Selecting
// either arrives as the child's Selected out-message and is folded in update.
// ---------------------------------------------------------------------------

const CREATE_PREFIX = 'create:'

const comboViewInputs = (
  combo: Model['draftCombo'],
  tags: ReadonlyArray<Tag>,
  selectedIds: ReadonlyArray<string>,
): Multi.ViewInputs<string> => {
  const query = combo.inputValue.trim()
  const hasExactMatch = tags.some((tag) => tag.label.toLowerCase() === query.toLowerCase())
  const items = [
    ...tags.map((tag) => tag.id),
    ...(query !== '' && !hasExactMatch ? [`${CREATE_PREFIX}${query}`] : []),
  ]
  const displayText = (item: string): string =>
    item.startsWith(CREATE_PREFIX)
      ? `Create “${item.slice(CREATE_PREFIX.length)}”`
      : labelOf(tags, item)
  return {
    items,
    selectedValues: selectedIds,
    restingInputValue: '',
    inputPlaceholder: 'Filter or create tags…',
    // Keep the listbox in place: native <dialog> panels live in the top
    // layer, which no z-index can outrank, so a body-level portal would be
    // unclickable behind the upload Dialog / edit Sheet.
    anchor: { placement: 'bottom-start', gap: 8, padding: 8, portal: false },
    itemToValue: (item) => item,
    itemToDisplayText: displayText,
    // ItemConfig.content is the rendered listbox row (Html, not a string).
    // Built with `inertHtml` — static content needs no dispatch wiring, and
    // the outer builder isn't guaranteed to be in scope when foldkit calls
    // itemToConfig.
    itemToConfig: (item) => {
      const content = inertHtml.span([], [displayText(item)])
      return item.startsWith(CREATE_PREFIX)
        ? {
            className:
              'text-stone-500 italic data-active:bg-stone-100 data-selected:bg-transparent',
            content,
          }
        : { content }
    },
  }
}

const embedCombo = (model: Model, which: 'draft' | 'upload', h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: `${which}-tag-combo`,
    model: which === 'draft' ? model.draftCombo : model.uploadCombo,
    view: TagMultiCombo.view,
    viewInputs: comboViewInputs(
      which === 'draft' ? model.draftCombo : model.uploadCombo,
      model.tags,
      which === 'draft' ? model.draftTagIds : model.uploadTagIds,
    ),
    toParentMessage: (message) =>
      which === 'draft'
        ? M.GotDraftComboMessage({ message })
        : M.GotUploadComboMessage({ message }),
  })

// ---------------------------------------------------------------------------
// header: search + tag filter pills + upload button
// ---------------------------------------------------------------------------

const header = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.header(
    [
      h.Class(
        'sticky top-0 z-20 border-b border-stone-200 bg-white/85 backdrop-blur px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-3',
      ),
    ],
    [
      h.div(
        [h.Class('flex items-center gap-4 mr-auto')],
        [
          h.a(
            [h.Href('/'), h.Class('text-sm font-semibold tracking-tight hover:text-stone-600')],
            ['photo.elianiva.com'],
          ),
          h.span([h.Class('text-xs uppercase tracking-widest text-stone-400')], ['Admin']),
        ],
      ),
      h.form(
        [h.OnSubmit(M.SubmitSearch()), h.Class('flex items-center gap-2')],
        [
          h.div(
            [h.Class('w-56')],
            [
              Input.input(
                {
                  id: 'admin-search',
                  label: '',
                  value: model.search,
                  placeholder: 'Search title…',
                  onInput: (value) => M.SetSearch({ value }),
                  wrapperClass: '!w-full',
                },
                h,
              ),
            ],
          ),
          Button.button({ onClick: M.SubmitSearch(), variant: 'outline', size: 'sm' }, 'Search', h),
        ],
      ),
      Button.button({ onClick: M.OpenUpload(), size: 'sm' }, 'Upload photos', h),
    ],
  )

const filterBar = (model: Model, h: HtmlBuilder<Msg>): Child => {
  const active = model.activeTagSlug ?? ''
  const pill = (
    label: string,
    slug: string | undefined,
    isActive: boolean,
    onDelete?: Msg,
  ): Child =>
    h.span(
      [
        h.Key(`pill-${slug ?? 'all'}`),
        h.Class('inline-flex items-center overflow-hidden rounded-full border'),
      ],
      [
        h.button(
          [
            h.OnClick(M.FilterByTag(slug === undefined ? { slug: '' } : { slug })),
            h.Class(
              cn(
                'pl-3 pr-2 py-1 text-xs font-medium transition-colors',
                isActive ? 'bg-stone-900 text-white' : 'bg-white text-stone-700 hover:bg-stone-100',
                onDelete !== undefined && 'pr-1',
              ),
            ),
          ],
          [label],
        ),
        ...(onDelete !== undefined
          ? [
              h.button(
                [
                  h.OnClick(onDelete),
                  h.AriaLabel(`Delete tag ${label}`),
                  h.Class('pr-2.5 text-xs text-stone-400 hover:text-red-600'),
                ],
                ['×'],
              ),
            ]
          : []),
      ],
    )

  return h.div(
    [h.Class('flex flex-wrap items-center gap-2 mt-6')],
    [
      pill('All photos', undefined, active === ''),
      ...model.tags.map((tag) =>
        pill(
          tag.label,
          tag.slug,
          active === tag.slug,
          M.RequestDeleteTag({ id: tag.id, label: tag.label }),
        ),
      ),
    ],
  )
}

// ---------------------------------------------------------------------------
// masonry grid
// ---------------------------------------------------------------------------

const photoCard = (photo: PhotoWithTags, h: HtmlBuilder<Msg>): Child =>
  h.figure(
    [
      h.Key(photo.id),
      h.Class('mb-4 break-inside-avoid cursor-pointer group'),
      h.OnClick(M.OpenEdit({ photo })),
    ],
    [
      h.img([
        h.Class(
          'w-full rounded-xl bg-stone-100 ring-stone-200 group-hover:ring-2 transition-shadow',
        ),
        h.Src(thumbUrl(photo)),
        h.Attribute('srcset', srcSet(photo)),
        h.Attribute('sizes', cardSizes),
        h.Alt(photo.title),
        h.Attribute('width', String(photo.width)),
        h.Attribute('height', String(photo.height)),
        h.Attribute('loading', 'lazy'),
      ]),
      h.figcaption(
        [h.Class('mt-2 px-1')],
        [
          h.div(
            [h.Class('flex items-baseline justify-between gap-2')],
            [
              h.h3([h.Class('text-sm font-medium truncate')], [photo.title]),
              h.span(
                [h.Class('text-[11px] text-stone-400 shrink-0')],
                [formatTakenAt(photo.takenAt)],
              ),
            ],
          ),
          (photo.tags ?? []).length > 0
            ? h.div(
                [h.Class('mt-1.5 flex flex-wrap gap-1')],
                [
                  ...(photo.tags ?? []).map((tag) =>
                    Badge.badge({ variant: 'secondary' }, [tag.label], h),
                  ),
                ],
              )
            : '',
        ],
      ),
    ],
  )

const grid = (model: Model, h: HtmlBuilder<Msg>): Child => {
  if (model.status === 'loading') {
    return h.p([h.Class('mt-10 text-sm text-stone-500 animate-pulse')], ['Loading photos…'])
  }
  if (model.status === 'error') {
    return h.div(
      [h.Class('mt-10 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800')],
      [
        h.p([], [model.error ?? 'Failed to load photos']),
        Button.button(
          { onClick: M.SubmitSearch(), variant: 'outline', className: 'mt-3', size: 'sm' },
          'Retry',
          h,
        ),
      ],
    )
  }
  if (model.photos.length === 0) {
    return h.div(
      [h.Class('mt-10 rounded-xl border border-dashed border-stone-300 p-10 text-center')],
      [
        h.p([h.Class('text-sm font-medium text-stone-700')], ['No photos yet']),
        h.p([h.Class('mt-1 text-sm text-stone-500')], ['Upload your first photo to get started.']),
      ],
    )
  }
  return h.div([], [
    h.div(
      [h.Class('mt-6 columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-4')],
      model.photos.map((photo) => photoCard(photo, h)),
    ),
    ...(model.nextCursor !== null
      ? [
          h.div(
            [h.Class('mt-8 flex justify-center')],
            [
              Button.button(
                {
                  onClick: M.LoadMore(),
                  variant: 'outline',
                  isDisabled: model.loadingMore,
                },
                model.loadingMore ? 'Loading…' : 'Load more',
                h,
              ),
            ],
          ),
        ]
      : []),
  ])
}

// ---------------------------------------------------------------------------
// edit sheet
// ---------------------------------------------------------------------------

const draftFieldInput = (
  model: Model,
  field: 'title' | 'slug' | 'takenAt' | 'caption' | 'location' | 'camera' | 'lens',
  label: string,
  h: HtmlBuilder<Msg>,
): Child =>
  field === 'caption'
    ? h.div(
        [h.Class('flex flex-col gap-1.5 w-full')],
        [
          h.label([h.For('draft-caption'), h.Class('text-sm font-medium')], ['Caption']),
          h.textarea([
            h.Id('draft-caption'),
            h.Value(model.draft.caption),
            h.OnInput((value) => M.SetDraftField({ field: 'caption', value })),
            h.Class(
              'border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            ),
          ]),
        ],
      )
    : Input.input(
        {
          id: `draft-${field}`,
          label,
          value: model.draft[field],
          onInput: (value) => M.SetDraftField({ field, value }),
          ...(field === 'takenAt' && { type: 'datetime-local', placeholder: 'From EXIF' }),
        },
        h,
      )

const editSheetContent = (
  model: Model,
  render: Sheet.SheetContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const editing = model.photos.find((photo) => photo.id === model.editingId)
  return [
    h.div(
      [h.Class('p-4 flex flex-col gap-4 overflow-y-auto')],
      [
        h.div(
          [h.Class('flex items-start justify-between gap-2')],
          [
            Sheet.title({ attributes: render.title }, ['Edit photo'], h),
            Sheet.closeButton({ attributes: render.closeButton }, ['×'], h),
          ],
        ),
        Sheet.description(
          { attributes: render.description },
          [editing?.slug ?? 'Adjust metadata and tags.'],
          h,
        ),
        editing !== undefined
          ? h.img([
              h.Class('w-full rounded-lg bg-stone-100 max-h-72 object-contain'),
              h.Src(thumbUrl(editing)),
              h.Attribute('srcset', srcSet(editing)),
              h.Attribute('sizes', cardSizes),
              h.Alt(editing.title),
            ])
          : '',
        draftFieldInput(model, 'title', 'Title', h),
        draftFieldInput(model, 'slug', 'Slug', h),
        draftFieldInput(model, 'takenAt', 'Taken at', h),
        draftFieldInput(model, 'location', 'Location', h),
        draftFieldInput(model, 'camera', 'Camera', h),
        draftFieldInput(model, 'lens', 'Lens', h),
        draftFieldInput(model, 'caption', 'Caption', h),
        h.div(
          [h.Class('flex flex-col gap-1.5')],
          [h.span([h.Class('text-sm font-medium')], ['Tags']), embedCombo(model, 'draft', h)],
        ),
      ],
    ),
    h.div(
      [h.Class('p-4 pt-0 mt-auto flex items-center gap-2')],
      [
        Button.button(
          {
            onClick: M.SaveEdits(),
            isDisabled: model.saving,
            className: 'flex-1',
          },
          model.saving ? 'Saving…' : 'Save changes',
          h,
        ),
        Button.button(
          {
            onClick: M.RequestDeletePhoto({
              id: editing?.id ?? '',
              label: editing?.title ?? 'this photo',
            }),
            variant: 'destructive',
            className: 'flex-1',
          },
          'Delete',
          h,
        ),
      ],
    ),
  ]
}

const editSheet = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-edit-sheet',
    model: model.editSheet,
    view: Sheet.view,
    viewInputs: Sheet.styledViewInputs<Msg>(
      {
        side: 'right',
        panelClass: 'w-full max-w-md',
        content: (render, innerH) => editSheetContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotEditSheetMessage({ message }),
  })

// ---------------------------------------------------------------------------
// upload dialog
// ---------------------------------------------------------------------------

const statusBadge = (item: QueueItem, h: HtmlBuilder<Msg>): Child => {
  if (item.status === 'uploading') {
    return h.span([h.Class('inline-flex items-center gap-1.5')], [
      Spinner.spinner({}, h),
      Badge.badge({ variant: 'default' }, ['Uploading…'], h),
    ])
  }
  const map: Record<
    Exclude<QueueItem['status'], 'uploading'>,
    { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
  > = {
    pending: { label: 'Queued', variant: 'secondary' },
    done: { label: 'Done', variant: 'outline' },
    failed: { label: 'Failed', variant: 'destructive' },
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing from QueueStatus union
  const config = map[item.status as Exclude<QueueItem['status'], 'uploading'>]
  return Badge.badge({ variant: config.variant }, [config.label], h)
}

const queueRow = (item: QueueItem, h: HtmlBuilder<Msg>): Child =>
  h.li(
    [
      h.Key(item.id),
      h.Class('flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2'),
    ],
    [
      h.div(
        [h.Class('min-w-0 flex-1')],
        [
          h.p([h.Class('truncate text-sm font-medium')], [item.name]),
          h.p(
            [h.Class('text-xs text-stone-500')],
            [
              item.error !== undefined
                ? `${formatBytes(item.size)} — ${item.error}`
                : formatBytes(item.size),
            ],
          ),
        ],
      ),
      statusBadge(item, h),
      ...(item.status === 'failed'
        ? [
            Button.button(
              { onClick: M.RetryUpload({ id: item.id }), variant: 'ghost', size: 'sm' },
              'Retry',
              h,
            ),
          ]
        : []),
      ...(item.status === 'pending' || item.status === 'failed'
        ? [
            Button.button(
              {
                onClick: M.RemoveQueueItem({ id: item.id }),
                variant: 'ghost',
                size: 'sm',
                attributes: [h.AriaLabel(`Remove ${item.name}`)],
              },
              '×',
              h,
            ),
          ]
        : []),
    ],
  )

const uploadDialogContent = (
  model: Model,
  render: Dialog.DialogContent<Msg>,
  h: HtmlBuilder<Msg>,
): ReadonlyArray<Child> => {
  const pendingCount = model.queue.filter((item) => item.status === 'pending').length
  const failedCount = model.queue.filter((item) => item.status === 'failed').length
  return [
    h.div(
      [h.Class('p-4 flex flex-col gap-4')],
      [
        h.div(
          [h.Class('flex items-start justify-between gap-2')],
          [
            Dialog.title({ attributes: render.title }, ['Upload photos'], h),
            Dialog.closeButton({ attributes: render.closeButton }, ['×'], h),
          ],
        ),
        Dialog.description(
          { attributes: render.description },
          ['Drop images below — dimensions and EXIF are extracted server-side.'],
          h,
        ),
        h.submodel({
          slotId: 'admin-file-drop',
          model: model.fileDrop,
          view: FileDrop.view,
          viewInputs: FileDrop.styledViewInputs<Msg>(
            {
              multiple: true,
              accept: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
              content: [
                h.p([h.Class('text-base font-medium')], ['Drag & drop images here']),
                h.p(
                  [h.Class('mt-1 text-sm text-muted-foreground')],
                  ['or click to browse — JPEG, PNG, WebP, GIF, AVIF'],
                ),
              ],
            },
            h,
          ),
          toParentMessage: (message) => M.GotFileDropMessage({ message }),
        }),
        ...(model.queue.length > 0
          ? [
              h.ul(
                [h.Class('flex flex-col gap-2 max-h-64 overflow-y-auto')],
                [...model.queue.map((item) => queueRow(item, h))],
              ),
              h.div(
                [h.Class('grid grid-cols-2 gap-3')],
                [
                  Input.input(
                    {
                      id: 'upload-taken-at',
                      label: 'Taken at (overrides EXIF)',
                      type: 'datetime-local',
                      value: model.uploadTakenAt,
                      onInput: (value) => M.SetUploadTakenAt({ value }),
                    },
                    h,
                  ),
                ],
              ),
              h.div(
                [h.Class('flex flex-col gap-1.5')],
                [
                  h.span([h.Class('text-sm font-medium')], ['Tags for this batch']),
                  embedCombo(model, 'upload', h),
                ],
              ),
              h.p(
                [h.Class('text-xs text-stone-500')],
                [
                  `${String(model.queue.length)}/${String(UPLOAD_LIMITS.maxFiles)} files · max ${String(UPLOAD_LIMITS.maxFileSize / (1024 * 1024))} MB each`,
                ],
              ),
              h.div(
                [h.Class('flex items-center justify-between gap-2 flex-wrap')],
                [
                  h.div([h.Class('flex items-center gap-2')], [
                    Button.button(
                      {
                        onClick: M.ClearFinishedItems(),
                        variant: 'ghost',
                        size: 'sm',
                        isDisabled: !model.queue.some((item) => item.status === 'done'),
                      },
                      'Clear finished',
                      h,
                    ),
                    ...(failedCount > 0
                      ? [
                          Button.button(
                            {
                              onClick: M.RetryAllFailed(),
                              variant: 'outline',
                              size: 'sm',
                            },
                            `Retry all (${String(failedCount)})`,
                            h,
                          ),
                        ]
                      : []),
                  ]),
                  Button.button(
                    {
                      onClick: M.StartUploads(),
                      isDisabled: model.uploading || pendingCount === 0,
                    },
                    model.uploading ? 'Uploading…' : `Upload ${pendingCount} photo(s)`,
                    h,
                  ),
                ],
              ),
            ]
          : []),
      ],
    ),
  ]
}

const uploadDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-upload-dialog',
    model: model.uploadDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        className: 'items-start pt-[8vh]',
        panelClass: 'w-full max-w-lg max-h-[84vh] overflow-y-auto',
        content: (render, innerH) => uploadDialogContent(model, render, innerH),
      },
      h,
    ),
    toParentMessage: (message) => M.GotUploadDialogMessage({ message }),
  })

// ---------------------------------------------------------------------------
// confirm dialog
// ---------------------------------------------------------------------------

const confirmDialog = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-confirm-dialog',
    model: model.confirmDialog,
    view: Dialog.view,
    viewInputs: Dialog.styledViewInputs<Msg>(
      {
        panelClass: 'w-full max-w-sm',
        content: (render, innerH) => [
          h.div(
            [h.Class('p-4 flex flex-col gap-4')],
            [
              h.div(
                [h.Class('flex items-start justify-between gap-2')],
                [
                  Dialog.title({ attributes: render.title }, ['Are you sure?'], innerH),
                  Dialog.closeButton({ attributes: render.closeButton }, ['×'], innerH),
                ],
              ),
              Dialog.description(
                { attributes: render.description },
                [
                  model.pendingConfirm === undefined
                    ? ''
                    : model.pendingConfirm.kind === 'photo'
                      ? `“${model.pendingConfirm.label}” will be removed from storage permanently.`
                      : `Tag “${model.pendingConfirm.label}” will be deleted and detached from all photos.`,
                ],
                innerH,
              ),
              h.div(
                [h.Class('flex justify-end gap-2')],
                [
                  Button.button(
                    {
                      onClick: M.GotConfirmMessage({
                        message: Dialog.Message.RequestedClose(),
                      }),
                      variant: 'outline',
                    },
                    'Cancel',
                    innerH,
                  ),
                  Button.button(
                    { onClick: M.ConfirmPending(), variant: 'destructive' },
                    'Yes, delete',
                    innerH,
                  ),
                ],
              ),
            ],
          ),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotConfirmMessage({ message }),
  })

// ---------------------------------------------------------------------------
// toast stack
// ---------------------------------------------------------------------------

const toastStack = (model: Model, h: HtmlBuilder<Msg>): Child =>
  h.submodel({
    slotId: 'admin-toasts',
    model: model.toast,
    view: AdminToast.view,
    viewInputs: AdminToast.styledViewInputs(
      model.toast,
      {
        position: 'BottomRight',
        toContent: (entry, innerH) => [
          innerH.p([innerH.Class('text-sm font-medium leading-none')], [entry.payload.title]),
          ...(entry.payload.detail !== undefined
            ? [innerH.p([innerH.Class('text-sm text-stone-500 mt-1')], [entry.payload.detail])]
            : []),
        ],
      },
      h,
    ),
    toParentMessage: (message) => M.GotToastMessage({ message }),
  })

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

export const view = (model: Model, h: HtmlBuilder<Msg>): Document => ({
  title: 'Admin — photo.elianiva.com',
  body: h.div(
    [h.Class('min-h-screen bg-stone-50 text-stone-900')],
    [
      header(model, h),
      h.main(
        [h.Class('mx-auto max-w-6xl px-6 pb-24')],
        [
          h.h1([h.Class('mt-8 text-2xl font-semibold tracking-tight')], ['Photos']),
          filterBar(model, h),
          grid(model, h),
        ],
      ),
      editSheet(model, h),
      uploadDialog(model, h),
      confirmDialog(model, h),
      toastStack(model, h),
    ],
  ),
})
