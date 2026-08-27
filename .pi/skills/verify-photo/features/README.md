# Photo verification map

This directory is the maintained source for verifying the user-facing behavior of photo.elianiva.com. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch `https://photo.localhost` via `pnpm dev` (portless `photo`, backing port 13370) with a single instance (`ACCESS_TEAM_DOMAIN` blank so admin runs unauthenticated). Resolve URL with `portless get photo`.
- D1 `photo-elianiva` and R2 `photo-elianiva-originals` are remote and shared even in dev — never truncate tables. Seed data uses prefix `verify-`.
- Put `agent-browser` and `portless` on PATH (`curl` optional for image header checks).
- Run `.pi/skills/verify-photo/scripts/doctor.sh` and require GET / on the portless URL with the Foldkit app shell.
- Never drive an instance that was not started by this verification run. One instance at a time.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over CSS selectors or DOM position. See actual labels in `packages/web/src/admin/view.ts` and `packages/web/src/gallery/view.ts`.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Run every user action through `npx agent-browser` (snapshot, click by role+name, fill, press, screenshot). No RPC or curl needed for e2e.
- Restore seeded verify- data after a mutation via the admin UI delete affordance. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the app identity (`Elianiva` / `photo.elianiva.com` header) visible.
- Mutation proof includes a second UI view of the stored value (re-open the sheet, reload the grid, or open the lightbox) — a toast alone is insufficient.
- Image proof is the lightbox `<img>` loading from `/api/image/<r2Key>` (visible pixels, alt text, no broken image).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with agent-browser` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Public gallery browse](./gallery-browse.md) covers visitor gallery, tag-filtered view, load-more pagination, and lightbox.
- [Admin upload](./admin-upload.md) covers the multipart upload path, blurhash handling, tag assignment on upload, and queue behavior.
- [Admin edit and delete photo](./admin-edit-delete.md) covers opening the edit sheet, changing draft fields and tags, save-then-relist ordering, and delete confirmation.
- [Tag management](./tag-management.md) covers creating tags from the manager, draft/upload combos, counting per-tag, and delete propagation.
