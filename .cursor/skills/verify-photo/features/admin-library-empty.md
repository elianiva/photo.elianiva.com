# Admin Library empty state

A Library that holds no Photographs at all draws the design's own empty state: a 240px dashed well with a 32px `Images` mark, `No frames yet`, `Drop your first photograph, or choose files from this computer.`, the two pickers, and `3:2 · 2:3 · 4:3 · 3:4 · 16:9 · 9:16 · ORIGINALS ARE KEPT` centred under it. `Choose files` and `Import from a folder` are both real file inputs: what they pick is queued the way a drop is queued, and the Upload dialog opens on the queue. A Library that has Photographs but whose filter selects none draws the other copy (`Nothing matches this filter`) and never this one.

## Sub-features

- `lib-empty-block` draws the design frame's block — dashed `color.outline`, 240px, 8px between parts, 24px of padding — with the mark, the title, the invitation and the two pickers.
- `lib-empty-ratios` prints the Ratio whitelist as a promise, read off the same list the filter and the crop use.
- `lib-empty-choose` opens the OS file picker for individual images and queues what it picks.
- `lib-empty-folder` opens the OS directory picker (`webkitdirectory`) and queues the images inside the chosen folder.
- `lib-empty-dialog` opens the Upload dialog over the queued files, so they can be tagged before anything is sent.
- `lib-empty-filtered` keeps the zero-Photograph state and the filtered-empty state as two different claims.

## How to get to it (user POV)

- Open `http://localhost:5173/admin` with the Library holding zero Photographs. The block is the whole page body, under the Page Head and the filter bar.
- Choose `Choose files` and pick one or more images in the OS picker.
- Choose `Import from a folder` and pick a folder; every image in it is offered to the queue.
- Either way the Upload dialog opens on the queue, where Tags and a takenAt can be set before `Upload N photos`.
- With one or more Photographs in the Library, filter the Library down to nothing (a Tag with no matches, or a search that matches no row) and the filtered-empty copy appears instead.

## Driving it with agent-browser

Preconditions:

- App is healthy at `http://localhost:5173/admin`.
- The Library holds zero Photographs (the block is the zero-Photograph state; a Library with rows never shows it).
- `.cursor/skills/verify-photo/scripts/doctor.sh` passes.
- `agent-browser set viewport 1440 900`, the design frame's own size.

- **The block is the design's.** Open the Library, then read the block's own numbers back:
  `npx agent-browser eval "const b = document.querySelector('[data-slot=\"empty\"]'); const s = getComputedStyle(b); JSON.stringify([b.getBoundingClientRect().height, s.rowGap, s.padding, s.borderTopWidth + ' ' + s.borderTopStyle])"`
  → `[240, "8px", "24px", "1px dashed"]`. The title measures Newsreader 24px with `-0.24px` tracking, the finishing line IBM Plex Mono 10px in `#7C766B`, and the gap from the block to that line is 24px.
- **Both pickers are real inputs.** Run `npx agent-browser eval "JSON.stringify([...document.querySelectorAll('[data-slot=\"empty\"] input[type=\"file\"]')].map((i) => [i.multiple, i.hasAttribute('webkitdirectory'), i.accept]))"`
  → two rows, both `multiple: true`, the second `webkitdirectory: true`, both with the five image types.
- **Choose files queues and opens the dialog.** The input is `sr-only`, so `agent-browser upload` cannot reach it; set its files and fire the same event the picker fires:
  `npx agent-browser eval "(async () => { const i = document.querySelector('[data-slot=\"empty\"] input:not([webkitdirectory])'); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(1024)], 'verify-lib-empty.png', { type: 'image/png' })); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return 'dispatched'; })()"`
  → the Upload dialog is open and its queue lists `verify-lib-empty.png` with a `Queued` badge. Screenshot it: `npx agent-browser screenshot .cursor/skills/verify-photo/artifacts/library-empty/dialog.png`.
- **Import from a folder does the same through the directory input.** Repeat the step above with `[data-slot="empty"] input[webkitdirectory]` → same dialog, same queue rows.
- **A cancelled picker changes nothing.** Fire `change` with an empty `DataTransfer` → no dialog opens and the queue is unchanged.
- **Proof.** Capture the block before any pick: `npx agent-browser snapshot > .cursor/skills/verify-photo/artifacts/library-empty/empty-state.aria.txt` and `npx agent-browser screenshot .cursor/skills/verify-photo/artifacts/library-empty/empty-state.png`. Keep both pickers' dialog screenshots next to them.
- **The filtered-empty state is untouched.** Add one Photograph, then apply a Tag that no Photograph carries: the body reads `Nothing matches this filter` and `No frames yet` is absent.

## Gotchas

- The OS picker itself cannot be automated. Setting the input's `files` and dispatching `change` is the same event the picker fires and is the only reachable path; what is proven is the wiring, not that a native window opened.
- `agent-browser upload <selector>` reports success without setting anything on an `sr-only` input. Verify with `input.files.length` before trusting it.
- The app clears the input after it handles `change`, so `input.files` reads empty afterwards. That is the handler having run, not a failed pick.
- Closing the Upload dialog without starting the batch drops the pending rows (the dialog's close releases the queue and revokes the previews). That is the Upload dialog's own behaviour, not the pickers'.
- The block's width follows the Admin's page column, not the frame's 1128px: the frame's `Main` has different gutters from the shell the Admin renders in.
- `$typography.exif` in `color.text.disabled` measures 3.95:1 against the page background, under WCAG AA for small text. The finishing line is one more instance of a token the sidebar and the Pager already use at that size; the design names it.
- The remote D1/R2 will not answer without Cloudflare credentials. When they are missing, the same block can be driven over the real Worker with an empty local D1 and R2 in its place — see `.cursor/skills/verify-photo/artifacts/library-empty/README.md`.
