# Broadsheet token layer — verification record

Feature: the `broadsheet` design system converted into `packages/web/src/tokens.css`
and adopted by the gallery and admin surfaces. Entry points: `/` and `/admin`.

## What was driven

Fresh `pnpm dev:local` (portless), real remote D1/R2 — no mocks.

| Surface                                      | Result                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `/` grid, 6 Photos                           | `page.aria.txt` in `artifacts/gallery-browse/` |
| `/` lightbox (click a figure, Escape closes) | `artifacts/gallery-lightbox/`                  |
| `/admin` grid, tags, density toggle          | `artifacts/admin-browse/`                      |
| `/admin` lightbox (`‹`/`›`/Close)            | `artifacts/admin-lightbox/`                    |
| `/admin` upload dialog                       | `artifacts/admin-upload.png`                   |
| `.dark` on `<html>`                          | `artifacts/dark-theme/`                        |

Screenshots for each live beside its snapshot as `page.png`; they are left
untracked, matching the existing convention here.

## Observed token values (gallery, light theme)

```
--role-surface                    #F3F0E8   (color.surface, newsprint paper)
--role-text-primary               #1B1A18   (color.text.primary, ink)
--font-serif                      Newsreader
body background                   rgb(243, 240, 232)
h1 font-size                      112px     (typography.nameplate at lg)
.type-kicker                      Libre Franklin 10px / 600 / 0.14em
```

Dark theme (`.dark` on `<html>`, read back after the class was applied):

```
body background                   rgb(27, 26, 24)    = #1B1A18
body color                        rgb(243, 240, 232) = #F3F0E8
```

That pair is the design system's dark `mirror`: `neutral.hint` takes the light
value of `neutral.intense` and the roles swap across the nine-role band.

## Caveats when re-running this

- The portless proxy could not bind 443 here (no sudo), so the run used
  `portless proxy start --port 1355 --https` and Chrome
  `--args "--host-resolver-rules=MAP *.localhost localhost:1355"`. Without the
  mapping, `https://photo-api.localhost` (which the client hardcodes with no
  port) is unreachable and the grid shows `HttpError:`.
- Two temporary shims in `packages/web/src/api-worker.ts` were needed before
  any data loaded, and were reverted before the commit:
  1. `POST /rpc/` 404s because the Effect client appends a trailing slash and
     the worker matches `url.pathname === '/rpc'`. Fix: trim trailing slashes
     from `url.pathname` before routing.
  2. The preflight fails because Effect now sends `b3` and `traceparent`
     tracing headers, which are absent from `access-control-allow-headers`.
     Fix: add them.
     Both are pre-existing and unrelated to the token layer. Production is
     unaffected: it serves `/api/rpc/` same-origin and so never preflights.
