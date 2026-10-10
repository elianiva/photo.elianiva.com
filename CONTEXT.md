# photo.elianiva.com

A curated photography showcase — the author's selected works. Every image is served as the original's bytes from R2 (there is no resizer, ADR 0002), and metadata and files are managed together in a single custom admin on `photo.elianiva.com/admin` (Cloudflare Access OTP-gated).

## Language

**Admin**:
The single-user management surface at `/admin` — browse, upload, edit, and delete Photos and Tags. Not a multi-user CMS; there is exactly one operator (the owner), gated by Cloudflare Access. The design's name for it, _The Desk_, is a visual brand, not a term.
_Avoid_: Dashboard, CMS, Studio, Backend, The Desk

**Photo**:
A curated work — a single image file (stored once in R2) plus its metadata. The unit the site showcases. Photos live in a flat list (no hierarchy); grouping is via Tags. Essential queryable fields are real columns (`title`, `takenAt`, dimensions, `r2Key`); the rest lives in a JSON `metadata` blob for cheap extensibility. The one carve-out from that rule is the four EXIF facts the public Exif line prints — `aperture`, `shutter`, `iso`, `focalLength` — which are columns because a formatted number has a type the boundary can check and a range it can validate; the blob keeps free-form strings like the caption, the place, and the camera body. Every one of the four is nullable, and a missing fact is omitted from the Exif line rather than invented.
_Avoid_: Image (use only for raw bytes/technical context), picture, shot

**Exif line**:
The one line under a public photo that names how the Photo was made — `X-T20 · 25MM · F/8 · 1/1000 · ISO 200 · 31 AUG`. Six segments in a fixed order: camera body, focal length, aperture, shutter, ISO, then the day and month of `takenAt`; uppercased and joined by `· `. A fact the Photo does not carry is a segment that is not printed — never a `0`, a dash, or a gap between two separators — and a Photo carrying no facts at all has no Exif line, so the view omits the element instead of rendering an empty one. A shutter at or above a second is written `2S` and one below it as the fraction a camera is marked with (`1/1000`); a time no shutter is marked with is written as a time (`0.7S`), never as a fraction no barrel carries. Produced by `formatExifLine` in `@photo/shared`, from a Photo read model.
_Avoid_: EXIF string, metadata line, tech specs, camera info

**Photo Number**:
A Photo's site-wide serial. One monotonic counter, assigned once at upload, unique across the site, and never reused — not by a deleted Photo, and not by a trashed one. The counter is its own, outside the Photos, because a count taken from the rows would reissue a serial the moment a purge deleted one. A Photo keeps its number through soft delete and restore. What the number is _titled_ in public copy is not settled. The site's own counter is the highest Photo Number among published, non-trashed Photos — the last photograph a visitor can see — so trashing the highest-numbered Photo moves the counter back while that Photo keeps its number in the Trash.
_Avoid_: ID (that is the ULID), ordinal, row number, index, page number

**Status**:
Where a Photo sits in the publish lifecycle: `draft`, `published`, or `failed`. Only `published` Photos are readable on the public site. `failed` marks a Photo whose processing did not finish. `scheduled` is not a fourth value — it is a display-only label over `draft` for a Photo with a future publish time, and nothing promotes it yet, so a Scheduled Photo is still a Draft. Nothing in the schema records a publish time, so there is no count of Scheduled Photos to report: the three stored Statuses are all there is.
_Avoid_: Visibility, stage, state, Published (that is one value of Status, not the term)

**Ratio**:
A Photo's frame proportion, always one of six supported values: `3:2`, `2:3`, `4:3`, `3:4`, `16:9`, `9:16`. The author sets it in the Editor's crop, and an incoming file is snapped to the nearest supported value at upload; a file outside every value's tolerance is refused rather than invented into one. The source file's own proportions stop mattering once a crop is authored. The Editor's `RATIO` control overrides the stored value; a stored Ratio always wins over a derived one — it is the frame the Photo is presented in — and `nearestRatio` only fills a Photo that carries none, so a legacy row still draws a frame rather than nothing.
_Avoid_: Aspect ratio, orientation, dimensions (those are the measured `width` and `height`)

**Crop**:
The window a Photo is presented through, authored in the Editor. `cropX` and `cropY` pan the source inside the Ratio, `cropScale` zooms it, `cropFlipX` mirrors it horizontally, and `level` is the straighten angle in degrees. The defaults — pan at origin, scale 1, un-mirrored, no level — mean an un-cropped Photo is the source as shot. A crop is authored data, so it is stored as columns and the Rendition is regenerated from it, never beside it.
_Avoid_: Resize, Zoom (that is the Stage's own control), Aspect ratio (that is the Ratio)

**Selection panel**:
The Library's right-hand panel (`/admin`, wide screens): the one selected Photo's preview, number, Status, Ratio, taken day, frame, Tags and Exif line, with `Edit` and `Delete`. It reads the Library's own selection, so a tick in the table, a tile in the grid and the Bulk Bar agree; several selected is a count that points at the Bulk Bar.
_Avoid_: Inspector (that is the Editor's 360px panel), Details, Preview pane

**Editor**:
The route at `/admin/photos/<id>` and the surface it draws: a Top Bar, a Stage and a 360px Inspector. It is dark like the rest of the Desk, and the only route with no Sidebar, so it is a document of its own rather than a page inside the shell — the same URL space, a different shell. The Stage shows the **draft**, not the stored Presentation, so an unsaved change is visible before it is saved; the Top Bar's `UNSAVED CHANGES` indicator and its `Discard` / `Update` pair are the Editor's own, and the `HISTORY` tab is deferred (decision 8) so no third tab is drawn, not even a disabled one. The Editor is **dirty** when its draft differs from the snapshot it loaded, which is a comparison against the stored fields rather than a set of touched ones, so `Discard` is exactly "put the snapshot back". Leaving with unsaved changes asks — `Escape`, `← Library`, a clicked link, a Back press and the browser's own `beforeunload` are the same rule — because an in-app history move never reaches the browser's dialog. `← Library` returns to the route the Editor was **opened from**, so a Photo reached from a filtered Library goes back to that same filter.
_Avoid_: Page (the Editor is a route and a document, not a page in the shell), Modal, Lightbox, Edit sheet (that is the retired Library overlay, decision 2), Detail (that is the `DETAILS` tab, a record)

**Presentation**:
The authored presentation of a Photo — its Crop, its `level`, its Mat and its per-photo export overrides (Rendition format JPEG/WEBP/AVIF, preview long edge, preview and full quality, keep-EXIF and remove-GPS) — saved as one call and one fact, and the reason a Rendition is regenerated from it.
_Avoid_: Post-processing, Effects, Filters

**Mat**:
The border the Editor draws around a Photo, outside its crop, before a Rendition is produced. The design heads its panel `BORDER`, labels its rows `Mat Colour` and `Mat Style`, and names the wrapper on the Stage `Mat` — one thing under two words. The schema and the code say `borderEnabled`, `borderStyle`, `borderColour`, `borderWidth`, following the heading the operator actually sees; `mat` appears only in the `color.mat.*` token names. Its colour is `white`, `paper` or `ink` and its style is `even`, `gallery` or `square`, taken from the design's swatches and segments.
_Avoid_: Frame (that is display copy), Padding, Margin, Mounter

**Watermark**:
A mark stamped onto an exported frame, configured per-site in Settings and applied per-upload. It goes onto **published renditions only**, and never onto the original: a download serves the original from R2, so an operator's copy of a photograph is always the unmarked file. The four corner positions and the centre are the whole value set, because a Select with one option is a control that lies. Whether anything stamps it yet is a separate fact from what the contract says.
_Avoid_: Logo, Overlay, Stamp (Stamp is the act, not the thing), Branding on renditions

**Rendition**:
A derived image file produced from a Photo's original. There are exactly two: `PREVIEW` (the long edge the Export panel sets, used by the library, the grid, and the public pages) and `FULL` (the presentation-sized export). A Rendition is regenerated whenever the crop, mat, level, or export settings change. The original in R2 is not a Rendition, and Renditions are never hand-placed in R2 outside the regeneration path.
_Avoid_: Derivative, thumbnail, variant, export (the export is the action; the file it produces is a Rendition)

**Tag**:
A label for grouping/filtering Photos (e.g., `kyoto`, `film`, `portrait`). Free-form, many-to-many with Photo. Has `slug` (URL-safe, unique), `label` (the name) and an optional `caption` (the one-line sentence the Tag's own public page prints under it, e.g. `Ferries, rain, and the long light on Istiklal.`). A Tag with no caption has `null` there, never an empty string. Managed from day one; no controlled vocabulary. A Tag is a **public document** as well as an Admin grouping: its slug is a URL (`/tag/<slug>`) and its label is the **Nav**'s entry for it, so a Tag renamed in the Admin renames a page's headline and a nav link in the same read.
_Avoid_: Collection (deferred), Category, Album, Series (that is a Tag page, not a stored entity)

**Nav**:
The public nav under the Header's edge — `ALL`, then one link per **Tag** that has a published Photo, then `ABOUT`. It is a **public read** (`PublicPhotoService.folio`), not a list of words in a view: a Tag is created, renamed and deleted in the Admin, and a nav written beside the header outlives every one of those. A Tag with nothing published under it is not a link, because the nav is a list of places that exist; the read is ordered by label, the same order the Admin's tag list is in. `ALL` is the home page and `ABOUT` is the About page, and the current section is marked by the document's own href rather than by a position in the list. The Footer prints the same entries again under `SECTIONS` — one list, read twice.
_Avoid_: Nav menu (the links are sections, not menus), Menu bar, Categories, Site Section (retired)

**Image**:
Raw file bytes / technical artifact. Not a domain term — use Photo for the showcased work.
_Avoid_: Photo (when you mean the file alone)

**Blurhash**:
A tiny string encoding a Photo's average color layout, encoded client-side (only the browser can decode pixels) and stored on the Photo. It is encoded from the raw file at upload, and re-encoded from the **cropped and matted composition** on every committed change in the Editor (a crop, a level, a mirror, a Mat toggle) — so the placeholder the public gallery decodes into a tile depicts the composition the visitor will see, not the uncropped original. It is a placeholder tile, not the photo: no image bytes are fetched until the visitor opens the lightbox, which shows the original HD file on plain white. The `4 × 3` component count is `image.blurhash.x` / `.y` in the design, a readout rather than a stored dimension.
_Avoid_: Placeholder image, thumbnail (the gallery no longer loads thumbnails)

**Frame**:
Not a domain term. The design says `412 FRAMES`, and the public Archive counts them in frames — `Nineteen frames this summer, four hundred and twelve in all.` That is display copy. Code, schema, and RPC all say Photo.
_Avoid_: Frame (as a type, column, or RPC field), Print

**Archive**:
The public chronological index of every published Photo at `/archive`, grouped by year and month and listed in the Nav. It is a read of the Photo list, not a stored entity — there is no archive table.
_Avoid_: Storage (that is the Admin's block), Library (that is the Admin's), Collection, Set

**About**:
The public page at `/about` — the photographer speaking, not a record of the archive. Its label, headline, lead, prose and Kit are authored text in the view that prints each line, so the page reads the same whether the archive holds one photograph or four hundred and claims no count and no month. The only thing a read contributes is the photos it leads with: published Photos, newest first, off the public list. The page has two compositions because the design has two masters — two prose columns and one photo on the desktop, one re-flowed paragraph and two photos on the mobile — and the photo the mobile master adds is drawn `lazy` and hidden at `desktop`, because there is no resizer and a photo no layout draws must not fetch a Photo's original (ADR 0002). It is a **route** of the public site's one app, not an app of its own: the Header, the Nav, the photos, the lightbox and the Footer are the chrome all three public documents share. A Site Section is retired, so `About` is now only this page and the Nav link to it.
_Avoid_: Bio, Profile, Site Section (retired), About page settings (there is no such row — migration 0008 dropped `aboutCopy`)

**Library**:
The Admin's list of every live Photo, and the surface the whole Admin is organised around. One route, one read (`ListLibraryRows`) and one filter, whatever shape that filter takes: a Status, a Ratio, a search, or the page's position in a keyset cursor. A **Tag** is not one of them: it is picked where a Photo is given it — the upload dialog's combo and the Bulk Bar's `Add tag` — and the rail lists no Tag index to filter by. The read answers with the page of rows, the cursor that would follow it, and the **filtered total** across every page — the last is what `1–7 OF 412` prints, so a pager never has to guess how many Photographs a filter selected. Selection is a claim about the rows on screen: it is a set of Photo ids, it is measured over the current page rather than over the total, and it is dropped when the filter changes, because a selection of forty that silently follows a new query is a bulk operation on forty Photographs the operator never chose. A bulk action is one call per concern over the ticked ids (`TrashPhotos`, `BulkAddTags`, `AddBorderToPhotos`) followed by a re-read of the list and the counts, never a patch of the rows in hand. A delete is reached from here and nowhere else: a Library `Delete` is a soft delete, and the Trash is a state rather than a page — the Admin lists no trashed Photo, so restoring and purging are RPCs and not destinations.
_Avoid_: Collection, Series, Gallery, the home page (that is the public read), Table (that is the design's arrangement of the Library, not a thing), Grid (a view mode over the same read)

**Storage**:
The Admin Settings block reporting what the Library holds and how long the Trash keeps. It shows the frame count, the Trash count, the CSV index, and the RETAIN setting. A count and a retention policy, not a place and not an archive of content. It used to report a byte total against a configured quota, and the sidebar's meter drew the same fraction; the column both summed is written only by an upload, so every Photograph older than that column counted zero and the one measurement on the Admin read `0.0 GB` for a Library that was not empty. The quota and the byte total are gone rather than drawn wrong, and the Trash count is the one fact they were replaced with that nothing else in the Admin states: no surface lists the Trash, so this block is where an operator learns that three Photographs are waiting there. The `RETAIN` setting is display-only: nothing purges on a timer anywhere in the chain, so it is drawn disabled at its one true value rather than offering a retention window no purge would honour.
_Avoid_: Archive (that is the public page), Library, Backup, Sync

**Session**:
The one operator, as the Cloudflare Access claim the Worker already verified — an `email` and the `teamDomain` that vouched for it, handed from `verifyAdminAccess` to the admin handlers as an `AdminSession` and read by `GetSession`. It is never recomputed from the request, and there is no signed-out state and no sign-in form: Access gates the route before any of this runs (ADR 0003), so a rejected `GetSession` replaces the whole shell with a session-expired affordance and nothing more. `teamDomain` is what makes the sidebar's `Sign out` a real link, because the Access logout lives under it, and it is the verified issuer rather than a bare host, so the URL is built by appending the endpoint to it. Both fields are null only on the `dev` stand-down, where the gate verifies nothing because there is nothing to verify, and that is where the sidebar prints no address and offers no sign-out rather than a placeholder.
_Avoid_: Login, Auth, Sign-in state, Current user

**Settings**:
The Admin's single-row singleton, read by the Editor's export defaults and the export/watermark/metadata policy. One row, `id` pinned to 1. Its `updatedAt` is what the Settings header's `SAVED 2 MINUTES AGO` reports, and it is nullable: a row nobody has saved has no date to report, so the header says so rather than naming the epoch. The page saves explicitly, so that stamp means something — a form with an unsaved edit reports `UNSAVED CHANGES` instead, which is the whole reason the header carries one. The row holds no site copy: the Header, the lede and the Footer are authored text, written in the view that prints each line, and a stored second source for the same sentence is copy nobody can find. The **Nav** is the one nav that is a read rather than text, because it is the site's **Tag**s. Every field on the row has a control that changes what the photograph pipeline does. Migration 0008 dropped the five that did not (`volume`, `motto`, `aboutCopy`, `sections`, `copyright`); the `SITE` section of the Settings page went with them.
_Avoid_: Config, Preferences, Options, Site settings (the row and the page are the same thing)
**Site Section** _(retired)_:
Previously: one entry in the public Nav, authored as an ordered list in Settings. The **Nav** is the site's **Tag**s read from the database now, and the `SiteSection` schema, the JSON codec and the Settings repeater that edited the column are gone (migration 0008). The term is kept so a reference to it reads as retired rather than as a thing to reintroduce.
_Avoid_: Nav item, menu, link, category
**Route**:
What a URL in the Admin's address space means — `Library`, `Scheduled`, `Settings`, `Photo`, `Atoms`, or `NotFound` — declared once in `admin/route.ts`, which prints a route back into its URL from the same routers and so is both directions of one table. The route is the whole of a URL's meaning in the Admin, so anything a URL decides (which page is drawn, which branch of the site theme it is drawn in, what the Page Head calls it, where a sidebar row points) is read off the route and never off a second copy of the path. A route is not a page: `Scheduled` resolves before its body lands (#29), and a row in the sidebar is only a link if its URL names a route. There is no `Drafts`, `Uploads` or `Trash` route: a draft is a **Status** the Filter Bar selects, the upload queue is the dialog that runs a batch, and the Trash is a Photo's state — none is a destination, so `/admin/drafts`, `/admin/uploads` and `/admin/trash` are in the Admin's URL space without naming a route, and they boot the Admin and draw its NotFound. `Atoms` (`/admin/atoms`) is the design-system sheet: the atoms of `components/ui` drawn once, at the design's own size, because no product page renders them until the Library, the Page Head and the Editor panels land. It is a surface, not a domain term, and nothing links to it.
_Avoid_: path prefix, pathname matching outside the route table, screen

**Trash**:
A Photo's soft-deleted state, and not a page. A Photo with a `deletedAt` is out of every list, count, meter and lookup, and its original stays in R2 — the delete that matters is reversible. Nothing in the Admin lists, restores or purges the Trash: the Library's `Delete` is the only way into it, and `RestorePhotos` and `PurgePhotos` are RPCs over the same rows. Purging is the only irreversible act, and the only one that touches R2 on delete. Nothing purges on a timer, and a Photo Number is not recycled by a purge.
_Avoid_: Bin, Recycle bin, Soft delete (that is the act, not the place), Archive (that is the public page)

**Public read**:
Any read the public site makes, and every one of them goes through `PublicPhotoService` (`@photo/api`). That service filters to `published` and non-Trashed **inside** itself, so no caller can forget the filter and a Draft or a trashed Photo cannot leak to a visitor. `PhotoService` is the Admin's read model and deliberately answers for Drafts, failed uploads and the Trash; the two are the same `Gateway` and the same row decoder, so they cannot disagree about what a Photo is. Grouping and counting are SQL, never a whole table dragged into the isolate to be sorted there. The ungated `/rpc` group is that read model and nothing else, so the Admin reads Photos through `/admin/rpc` instead: the Editor still gets its Drafts, and `/rpc` cannot leak one.
_Avoid_: public query, guest query, frontend query, live query

**Tag page**:
One **Tag**'s published Photos at `/tag/<slug>` — the Tag's label as the headline, its caption as the lead, its photographs in published order earliest first, and its frame count on the rule under them. There is no Series entity and no curated order (ADR 0006): a Series page _is_ a Tag page, so the earliest Photo is the cover. It is a **route** of the one public app like the home page and the About page, draws no load-more row (a Tag's Photos are read whole, not paged through months), and answers a slug no Tag carries with a `404` status rather than with another document — the site has no `404` document of its own yet.
_Avoid_: Series page (that is this page, not a stored entity), Gallery page, Category page

**Month**:
One month of the home page's Timeline — `August 2025`, headed by the design's month head and counted `08 FRAMES · NO. 016–023`. It is a grouping a public read computes, not a stored entity: `takenAt` is `YYYY-MM-DD` TEXT, so `substr(takenAt, 1, 7)` groups published Photos into Months and the frame count and number range are SQL aggregates over that month's published set. A published Photo with no `takenAt` belongs to no Section, because a Section is a month. The home page walks backwards through Months as the visitor scrolls, so its cursor is a month (`2025-08`), not a Photo. An Months is the only thing on the home page that is counted, because it counts photographs: the header counts nothing at all, and the home page's text is authored rather than read.
_Avoid_: Section (ambiguous — a Site Section was the nav entry), Edition, Page

**Timeline**:
The home page's list of **Month**s, newest first, plus the **tail** that says whether more can be loaded (`more`, `end` or `empty`). Drawn as a contact sheet: one row per Month, a numeral and a handwritten month-and-count note in the rail, and the Month's Photos in a strip of film frames. The newest frame on the page is circled by hand; that is the only mark that is not printed, and it is a fact the data holds (the newest published Photo), not a setting. It is a read of the Photo list, not a stored entity.
_Avoid_: Edition, Feed, Gallery

**Collection** _(deferred)_:
Previously: a curated group of Photos (e.g., "Kyoto 2024"). Replaced by flat list + Tags for v1. Kept as a deferred term; reintroduce only if you need ordered, titled groupings with a cover.
_Avoid_: Album, Gallery, Series, Set

**Cover Photo** _(deferred)_:
Previously: the representative Photo of a Collection. Deferred with Collection.
_Avoid_: Hero image, featured image

## Design language

**Site theme**:
The visual system the whole site is drawn in, hand-written as
`packages/web/src/theme.css`. Paper, ink, hairline rules, a
label/exif/lead type hierarchy, and no rounded corners on the Desk's
controls. Colour and type are the only two things it holds: every length,
radius, duration and breakpoint is Tailwind's own scale, written inline where
it is used — `p-3`, never `p-(--spacing-md)`.
_Avoid_: shadcn defaults, pill buttons, card shadows, a second scale beside
Tailwind's

**Role token**:
A colour in the site theme, named by what it does rather than what it looks
like — `bg-role-surface`, `border-role-hairline`, `text-role-text-secondary`.
Reached as a utility, so it follows the **Theme scope**; a hex literal in Desk
code is a defect.
_Avoid_: palette colour (`neutral-500`), shadcn name (`--muted-foreground`) in Desk code

**Type composite**:
A named typographic decision — `type-ui`, `type-label`, `type-exif` — declared
once as a `@utility` in `theme.css`. One decision named once, rather than four
utilities repeated at every place that text is drawn.
_Avoid_: spelling a composite out inline, a composite nothing draws

**Contract name**:
A shadcn semantic name (`--background`, `--muted-foreground`, `--ring`) bound
to a site theme role. It exists so the vendored foldcn registry keeps its
vocabulary; Desk code says the role, not the contract name.
_Avoid_: extending the contract with a name site theme does not have

**Theme scope**:
The element a site theme branch is named on: `data-theme="light" | "dark"`,
with `.dark` on the document root the same block spelled as a class.
The branch is a function of the Admin's **Route** and of nothing else, so the
view names it on the app root and the HTML shell names it on `<html>` — the
only element there is before the app has run. Every Admin route is dark — the Desk is
the darkroom — and the public site is light.
_Avoid_: a path prefix for the Editor, toggling the theme after mount, a second
hand-written dark palette
