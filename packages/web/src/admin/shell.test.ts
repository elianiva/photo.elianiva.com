/**
 * The Admin shell, driven the way the operator drives it: a cold load, the
 * clicks the sidebar offers, and a session the API refuses. Every step goes
 * through the real `init` / `update` / `view`.
 *
 * The seed is a cold load whose responses have been folded through the same
 * `update` the runtime folds Command results through, so the page these scenes
 * draw is the one the runtime would have drawn. The cold load's own dispatched
 * commands are asserted in `route.test.ts`; what matters here is the page the
 * responses produce and what the operator's clicks dispatch next.
 */

import { Option } from 'effect'
import { Scene } from 'foldkit'
import { fromString as urlFromString } from 'foldkit/url'
import { describe, expect, it } from 'vitest'
import { STORAGE_CAP_BYTES, TagId } from '@photo/shared'
import type { Tag } from '@photo/shared'
import * as Animation from '@foldkit/ui/animation'
import { AcquireResources, CloseDialog, ShowDialog } from '@foldkit/ui/dialog'

import * as Dialog from '@/components/ui/dialog'

import { CreateTagCmd, FetchCountsCmd, FetchPhotosCmd, ReplaceUrlCmd } from './commands'
import { Message } from './model'
import type { Counts, Model } from './model'
import { init, update } from './update'
import { view } from './view'

const ORIGIN = 'https://photo.elianiva.com'
const TEAM = 'https://team.elianivaaccess.test'
const OWNER = 'owner@photo.test'

const at = (pathname: string) => {
  const parsed = urlFromString(`${ORIGIN}${pathname}`)
  if (Option.isNone(parsed)) throw new Error(`not a URL: ${pathname}`)
  return parsed.value
}

const app = { update, view }

const tag = (slug: string, label: string): Tag => ({
  id: TagId.make(slug),
  slug,
  label,
  caption: null,
})

const TAGS: ReadonlyArray<Tag> = [tag('kyoto', 'Kyoto'), tag('nyc', 'New York')]

const COUNTS: Counts = {
  total: 412,
  trashed: 3,
  byStatus: { draft: 7, published: 402, failed: 1 },
  byTag: [
    { id: TagId.make('kyoto'), label: 'Kyoto', count: 38 },
    { id: TagId.make('nyc'), label: 'New York', count: 52 },
  ],
}

/** 7.9 GB and 412 Photos against the one cap `STORAGE_CAP_BYTES` declares,
 *  which is the same constant the Storage block is measured against and the
 *  same read the sidebar's meter draws. */
const STORAGE = { photos: 412, bytes: 7_900_000_000, capBytes: STORAGE_CAP_BYTES }

const listed = Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 })

/** A cold load of `pathname` with the operator signed in and the library
 *  answered: the session claim, the counts, the storage aggregate, the tags
 *  and the list, in the order the API would answer them. */
const signedIn = (pathname: string): Model =>
  [
    Message.SucceededGetSession({ email: OWNER, teamDomain: TEAM }),
    Message.SucceededGetCounts(COUNTS),
    Message.SucceededGetStorage(STORAGE),
    Message.SucceededFetchTags({ tags: [...TAGS] }),
    listed,
  ].reduce((model, message) => update(model, message).model, init(at(pathname)).model)

const cold = (pathname: string) => Scene.given(signedIn(pathname))

const navLink = (name: string) => Scene.role('link', { name })
const tagRow = (label: string) => Scene.role('button', { name: label })
const searchField = Scene.role('searchbox', { name: 'Search photographs' })
const searchForm = Scene.selector('[data-slot="search-form"]')
const tagCreateForm = Scene.selector('[data-slot="tag-create-form"]')

/** The steps a Dialog submodel needs answered when it opens. The dialog's own
 *  show/paint/acquire commands are its business, and the app's Messages are
 *  what a scene is about, so the framework's are resolved by name here rather
 *  than left dangling. */
const dialogOpened = (id: string) => [
  Scene.Command.resolve(
    ShowDialog({ id, focusSelector: '[data-foldkit-dialog-initial-focus]' }),
    Dialog.Message.SucceededShowDialog(),
  ),
  Scene.Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint()),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: `${id}-panel` }),
    Animation.Message.EndedAnimation(),
  ),
  Scene.Mount.resolve(AcquireResources, Dialog.Message.SucceededAcquireResources()),
]

/** The same, for the close that follows a create: the leave paint, the settled
 *  animation, then the close itself. */
const dialogClosed = (id: string) => [
  Scene.Command.resolve(Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint()),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: `${id}-panel` }),
    Animation.Message.EndedAnimation(),
  ),
  Scene.Command.resolve(CloseDialog({ id }), Dialog.Message.CompletedCloseDialog()),
]

const TAG_ACTIONS = 'admin-tag-actions'
const CONFIRM = 'admin-confirm-dialog'

describe('the sidebar nav', () => {
  it('gives every primary destination a real link out of the route table', () => {
    // Each row is an anchor carrying the URL the route table prints, so a cold
    // load of that URL boots the Admin on the row that was clicked — no
    // hand-written path string, no second copy of the route table.
    Scene.scene(
      app,
      cold('/admin'),
      Scene.expect(navLink('Library 412')).toHaveAttr('href', '/admin'),
      Scene.expect(navLink('Drafts 7')).toHaveAttr('href', '/admin/drafts'),
      Scene.expect(navLink('Scheduled')).toHaveAttr('href', '/admin/scheduled'),
      Scene.expect(navLink('Settings')).toHaveAttr('href', '/admin/settings'),
    )
  })

  it('marks the current row, and only that row', () => {
    Scene.scene(
      app,
      cold('/admin/settings'),
      Scene.expect(navLink('Settings')).toHaveAttr('aria-current', 'page'),
      Scene.expect(navLink('Settings')).toHaveAttr('data-state', 'active'),
      Scene.expect(navLink('Library 412')).not.toHaveAttr('aria-current'),
    )
  })

  it('carries no row for Uploads or Trash, which are not pages', () => {
    // Neither is a destination: the upload queue is the dialog that runs a
    // batch, and the Trash is a state the Library's Delete produces rather than
    // a list somewhere to go. A row pointing at either would be a link to a
    // path no route names, and neither `byStatus.failed` nor the trashed count
    // invents one — they are still facts the Library's filter reads.
    const clean: Counts = { ...COUNTS, byStatus: { ...COUNTS.byStatus, failed: 0 } }
    Scene.scene(
      app,
      Scene.given(update(signedIn('/admin'), Message.SucceededGetCounts(clean)).model),
      Scene.expect(Scene.role('link', { name: /^Uploads/ })).not.toExist(),
      Scene.expect(Scene.role('link', { name: /^Trash/ })).not.toExist(),
    )
  })

  it('leaves the count slot empty for the two rows with no count to report', () => {
    // Scheduled has no count because nothing records a publish time
    // (CONTEXT.md, Status) and Settings has none because it is a singleton. The
    // design reserves the slot and prints nothing in it, so a zero would be a
    // claim these two cannot make.
    Scene.scene(
      app,
      cold('/admin'),
      Scene.expect(navLink('Scheduled 0')).not.toExist(),
      Scene.expect(navLink('Settings 0')).not.toExist(),
      Scene.expect(navLink('Scheduled')).toExist(),
      Scene.expect(navLink('Settings')).toExist(),
    )
  })
})

describe('the sidebar tags group', () => {
  it('shows one row per tag with the count it was given', () => {
    Scene.scene(
      app,
      cold('/admin'),
      Scene.expect(tagRow('Kyoto 38')).toHaveAttr('aria-pressed', 'false'),
      Scene.expect(tagRow('New York 52')).toHaveAttr('aria-pressed', 'false'),
      // A row that filters in place is a button, not a link: it changes the
      // list under the current URL rather than navigating.
      Scene.expect(Scene.role('link', { name: 'Kyoto 38' })).not.toExist(),
    )
  })

  it('narrowing is multi-select: a second tag adds to the fetch, not replaces it', () => {
    // The resolver matches on the command's arguments, so a filter that sent
    // only the last tag would leave this FetchPhotos unresolved and the scene
    // would fail rather than quietly pass.
    Scene.scene(
      app,
      cold('/admin'),
      Scene.click(tagRow('Kyoto 38')),
      Scene.Command.resolve(
        FetchPhotosCmd({ tagIds: ['kyoto'], q: '' }),
        Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 }),
      ),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.click(tagRow('New York 52')),
      Scene.Command.resolve(
        FetchPhotosCmd({ tagIds: ['kyoto', 'nyc'], q: '' }),
        Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 }),
      ),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.expect(tagRow('Kyoto 38')).toHaveAttr('aria-pressed', 'true'),
      Scene.expect(tagRow('New York 52')).toHaveAttr('aria-pressed', 'true'),
    )
  })

  it('carries the applied tags through a submitted search', () => {
    Scene.scene(
      app,
      cold('/admin'),
      Scene.click(tagRow('Kyoto 38')),
      Scene.Command.resolve(
        FetchPhotosCmd({ tagIds: ['kyoto'], q: '' }),
        Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 }),
      ),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
      Scene.type(searchField, 'istanbul'),
      Scene.expect(searchField).toHaveValue('istanbul'),
      Scene.submit(searchForm),
      Scene.Command.resolve(
        FetchPhotosCmd({ tagIds: ['kyoto'], q: 'istanbul' }),
        Message.SucceededFetchPhotos({ photos: [], nextCursor: null, total: 0 }),
      ),
      Scene.Command.resolve(ReplaceUrlCmd, Message.CompletedNavigate()),
    )
  })

  it('creates a tag from a row’s actions, then closes the sheet and re-reads the counts', () => {
    Scene.scene(
      app,
      cold('/admin'),
      Scene.click(Scene.role('button', { name: 'Tag actions for Kyoto' })),
      ...dialogOpened(TAG_ACTIONS),
      Scene.expect(Scene.role('dialog')).toExist(),
      Scene.expect(Scene.role('button', { name: 'Delete tag Kyoto' })).toExist(),
      Scene.type(Scene.role('textbox', { name: 'New tag' }), 'lisbon'),
      Scene.submit(tagCreateForm),
      Scene.Command.resolve(
        CreateTagCmd({ source: 'sidebar', label: 'lisbon' }),
        Message.SucceededCreateTag({ source: 'sidebar', tag: tag('lisbon', 'lisbon') }),
      ),
      // A new Tag carries no photos, but it does carry a row, so the counts
      // are re-read rather than the row spliced in — and the sheet that
      // produced it is gone.
      Scene.Command.resolve(FetchCountsCmd, Message.SucceededGetCounts(COUNTS)),
      ...dialogClosed(TAG_ACTIONS),
      // The sheet is gone, not merely hidden: nothing of it survives the create.
      Scene.expect(Scene.role('textbox', { name: 'New tag' })).not.toExist(),
      Scene.expect(tagRow('lisbon 0')).toExist(),
      // The dialog's resource Mount went away with the panel, which the scene
      // has to be told about: an unacknowledged unmount fails the run.
      Scene.Mount.expectEnded(AcquireResources),
    )
  })

  it('deletes a tag through the shared confirm dialog, not a second dialog', () => {
    // The tag's own actions Dialog is closed and the shared confirm opened in
    // the same transition. Emitted as a subscription message because the
    // gesture under test is the confirm the delete opens, not the menu click
    // that preceded it — the menu's own Scene is above.
    Scene.scene(
      app,
      cold('/admin'),
      Scene.Subscription.emit(Message.RequestDeleteTag({ id: 'kyoto', label: 'Kyoto' })),
      ...dialogOpened(CONFIRM),
      // The one confirm every destructive action uses, and its copy names the
      // Tag that is about to go.
      Scene.expect(Scene.role('button', { name: 'Yes, delete' })).toExist(),
      Scene.expect(
        Scene.text('Tag “Kyoto” will be deleted and detached from all photos.'),
      ).toExist(),
    )
    // The sheet forgets its subject the moment the delete is asked for, so a
    // later close or confirm cannot act on a Tag the operator has moved on from.
    const asked = update(
      signedIn('/admin'),
      Message.RequestDeleteTag({ id: 'kyoto', label: 'Kyoto' }),
    )
    expect(asked.model.tagActionsId).toBeUndefined()
  })
})

describe('the session', () => {
  it('prints the verified claim and offers the Access sign-out', () => {
    Scene.scene(
      app,
      cold('/admin'),
      Scene.expectAll(Scene.all.text(OWNER)).toHaveCount(1),
      Scene.expect(navLink('Sign out')).toHaveAttr('href', `${TEAM}/cdn-cgi/access/logout`),
    )
  })

  it('prints no address and offers no sign-out where the gate stood down', () => {
    // The dev stage creates no Access applications, so there is no identity to
    // print and no session to end. A placeholder address would be a lie about
    // who is signed in, and a sign-out link would go nowhere.
    const ungated = update(
      signedIn('/admin'),
      Message.SucceededGetSession({ email: null, teamDomain: null }),
    ).model
    Scene.scene(
      app,
      Scene.given(ungated),
      Scene.expect(navLink('Sign out')).not.toExist(),
      Scene.expectAll(Scene.all.selector('[data-slot="sidebar-footer"] p')).toBeEmpty(),
    )
  })

  it('replaces the whole Admin with the sign-in affordance when GetSession is refused', () => {
    const refused = update(init(at('/admin')).model, Message.FailedGetSession({}))
    Scene.scene(
      app,
      Scene.given(refused.model),
      Scene.expect(Scene.role('heading', { name: 'Session expired' })).toExist(),
      // The way back is a document request for the Admin's own URL, because
      // that is the request Access turns into a login — it runs at the edge,
      // before the Worker. Not a `/cdn-cgi/access/login` path, which is the
      // team domain's endpoint and a bare 404 on any origin without an Access
      // edge in front of it.
      Scene.expect(Scene.role('link', { name: 'Sign in again' })).toHaveAttr('href', '/admin'),
      // There is no signed-out state in the app: the shell is gone rather than
      // half-drawn, and no password field exists anywhere — Access is the
      // credential boundary (ADR 0003).
      Scene.expect(Scene.role('navigation', { name: 'Admin sections' })).not.toExist(),
      Scene.expectAll(Scene.all.selector('input[type="password"]')).toBeEmpty(),
    )
  })

  it('sends the operator back to the route they were on', () => {
    // Access returns a completed login to the URL that started it, so the
    // affordance names the page rather than the Admin's root.
    const refused = update(init(at('/admin/photos/abc')).model, Message.FailedGetSession({}))
    Scene.scene(
      app,
      Scene.given(refused.model),
      Scene.expect(Scene.role('link', { name: 'Sign in again' })).toHaveAttr(
        'href',
        '/admin/photos/abc',
      ),
    )
  })
})

describe('the storage meter', () => {
  it('reports the real aggregate against the one cap, never a placeholder', () => {
    Scene.scene(
      app,
      cold('/admin'),
      // 7.9 GB of the 20 GiB `STORAGE_CAP_BYTES` declares, both read off
      // GetStorageUsage.
      Scene.expectAll(Scene.all.text('7.9 / 21 GB')).toHaveCount(1),
    )
  })
})

describe('the Page Head', () => {
  it('names the route it is drawn on', () => {
    Scene.scene(
      app,
      cold('/admin/drafts'),
      Scene.expect(Scene.role('heading', { name: 'Drafts' })).toExist(),
    )
  })

  it('carries the search field with its shortcut keycap, and the Upload button', () => {
    Scene.scene(
      app,
      cold('/admin'),
      Scene.expect(searchField).toExist(),
      Scene.expect(Scene.role('button', { name: 'Upload' })).toExist(),
      // The keycap is the chord the document listener answers to, printed as
      // the Mac one or the PC one.
      Scene.expectAll(Scene.all.selector('kbd')).toHaveCount(1),
    )
  })

  it('draws no search on a route with no list to search', () => {
    // A search box on a page with no list is a control that lies, so the atoms
    // sheet gets the title it can answer for and nothing else.
    Scene.scene(
      app,
      cold('/admin/atoms'),
      Scene.expect(Scene.role('heading', { name: 'Atoms' })).toExist(),
      Scene.expect(searchField).not.toExist(),
    )
  })
})
