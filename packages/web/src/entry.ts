import './styles.css'
import { Runtime } from 'foldkit'
import type { MakeRuntimeReturn } from 'foldkit/runtime'
import { isAdminPath } from './admin/route'
import type * as AdminApp from './admin/entry'
import type * as PublicApp from './public/entry'
import { Flags } from './public/model'

/**
 * Single SPA entry with route-based code splitting: an `/admin` URL loads the
 * Admin bundle, every other path loads the public site. Visitors
 * never ship the admin Sheet/Dialog/FileDrop/combobox unless they visit
 * /admin. The split asks the same question the Worker does — is this the
 * Admin's URL space — so a path inside it that names no route still boots the
 * Admin and gets its NotFound page.
 *
 * The public site's own routes (`/`, `/about`) need no branch here: which
 * document is drawn travels in the Flags the Worker stamped, and this bundle is
 * already the one that boots for both.
 */
if (isAdminPath(window.location.pathname)) {
  void import('./admin/entry').then((admin: typeof AdminApp) => {
    const program = Runtime.makeApplication({
      Model: admin.Model,
      init: admin.init,
      update: admin.update,
      view: admin.view,
      subscriptions: admin.subscriptions,
      container: document.getElementById('root'),
      // The runtime owns the URL bar: it reports a clicked plain anchor and
      // every popstate as Messages, which the update folds into routes.
      routing: {
        onUrlRequest: admin.onUrlRequest,
        onUrlChange: admin.onUrlChange,
      },
      devTools: {
        Message: admin.Message,
      },
    })
    const isHydratable = document.querySelector('[data-foldkit-app]') !== null
    if (isHydratable) {
      Runtime.hydrate(program, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
    } else {
      Runtime.run(program)
    }
  })
} else {
  void import('./public/entry').then((site: typeof PublicApp) => {
    // The photographs were read on the Worker that rendered this page and
    // arrive in the hydration stamp, so the browser decodes them rather than
    // fetching them: a reader sees the photographs in the HTML they received,
    // and nothing reads D1 a second time to answer the same page.
    const program: MakeRuntimeReturn<undefined, Flags, never, 'Application'> =
      Runtime.makeApplication({
        Model: site.Model,
        Flags,
        init: site.init,
        update: site.update,
        view: site.view,
        subscriptions: site.subscriptions,
        container: document.getElementById('root'),
        devTools: {
          Message: site.Message,
        },
      })
    // A public document is only ever a server-rendered one. Its photographs are
    // read by the Worker that renders it and travel in the hydration stamp, and
    // `init` needs those flags — so there is no client-only boot to fall back
    // to, and `Runtime.run` (which is typed for an app without Flags) would have
    // nothing to pass. A page that reaches here without a stamp was not
    // rendered by the Worker at all, and hydrating is what says so.
    //
    // The type arguments are named because `hydrate` infers the Flags type from
    // an *optional* phantom property on the runtime, finds no inference
    // candidate there, and falls back to the parameter's `void` default — which
    // then rejects the very runtime it was handed. `makeApplication` infers its
    // own generics from the config's real `Flags` schema, so only this call
    // needs pinning.
    Runtime.hydrate<undefined, Flags, never>(program, {
      buildId: import.meta.env.FOLDKIT_BUILD_ID,
    })
  })
}
