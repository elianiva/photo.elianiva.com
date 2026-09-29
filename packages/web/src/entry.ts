import './styles.css'
import { Runtime } from 'foldkit'
import { isAdminPath } from './admin/route'
import type * as AdminApp from './admin/entry'
import type * as HomeApp from './home/entry'

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
    // The front page ships its edition in the bundle, so there is no fetch to
    // await before the first paint — `run` is the whole lifecycle here.
    const program = Runtime.makeApplication({
      Model: home.Model,
      init: home.init,
      update: home.update,
      view: home.view,
      subscriptions: home.subscriptions,
      container: document.getElementById('root'),
      devTools: {
        Message: home.Message,
      },
    })
    const isHydratable = document.querySelector('[data-foldkit-app]') !== null
    if (isHydratable) {
      Runtime.hydrate(program, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
    } else {
      Runtime.run(program)
    }
  })
}
