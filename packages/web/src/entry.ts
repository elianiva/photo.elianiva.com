import './styles.css'
import { Runtime } from 'foldkit'
import type * as AdminApp from './admin/entry'
import type * as HomeApp from './home/entry'

/**
 * Single SPA entry with route-based code splitting: `/admin` loads the Admin
 * bundle, every other path loads the broadsheet front page. Visitors never
 * ship the admin Sheet/Dialog/FileDrop/combobox unless they visit /admin.
 */
const isAdmin = window.location.pathname.startsWith('/admin')

if (isAdmin) {
  void import('./admin/entry').then((admin: typeof AdminApp) => {
    const program = Runtime.makeApplication({
      Model: admin.Model,
      init: admin.init,
      update: admin.update,
      view: admin.view,
      subscriptions: admin.subscriptions,
      container: document.getElementById('root'),
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
