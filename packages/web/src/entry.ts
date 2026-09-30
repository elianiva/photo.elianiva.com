import './styles.css'
import { Runtime } from 'foldkit'
import type { MakeRuntimeReturn } from 'foldkit/runtime'
import { isAdminPath } from './admin/route'
import type * as AdminApp from './admin/entry'
import type * as HomeApp from './home/entry'
import { Flags } from './home/model'

/**
 * Single SPA entry with route-based code splitting: an `/admin` URL loads the
 * Admin bundle, every other path loads the broadsheet front page. Visitors
 * never ship the admin Sheet/Dialog/FileDrop/combobox unless they visit
 * /admin. The split asks the same question the Worker does — is this the
 * Admin's URL space — so a path inside it that names no route still boots the
 * Admin and gets its NotFound page.
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
  void import('./home/entry').then((home: typeof HomeApp) => {
    // The Edition was read on the Worker that rendered this page and arrives in
    // the hydration stamp, so the browser decodes it rather than fetching it: a
    // reader sees the photographs in the HTML they received, and nothing reads
    // D1 a second time to answer the same page.
    const program: MakeRuntimeReturn<undefined, Flags, never, 'Application'> =
      Runtime.makeApplication({
        Model: home.Model,
        Flags,
        init: home.init,
        update: home.update,
        view: home.view,
        subscriptions: home.subscriptions,
        container: document.getElementById('root'),
        devTools: {
          Message: home.Message,
        },
      })
    // The Front is only ever a server-rendered document. The Edition is read by
    // the Worker that renders it and travels in the hydration stamp, and `init`
    // needs those flags — so there is no client-only boot to fall back to, and
    // `Runtime.run` (which is typed for an app without Flags) would have nothing
    // to pass. A page that reaches here without a stamp was not rendered by the
    // Worker at all, and hydrating is what says so.
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
