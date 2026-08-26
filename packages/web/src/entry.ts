import './styles.css'
import { Runtime } from 'foldkit'
// Type-only: erased at compile time, so route-based code splitting below
// (dynamic import of the admin bundle) is untouched.
import type * as AdminApp from './admin/entry'
import type * as GalleryApp from './main'

/**
 * Single SPA entry with route-based code splitting: `/admin` loads the Admin
 * bundle, every other path loads the public gallery. Visitors never ship
 * the admin Sheet/Dialog/FileDrop/combobox unless they visit /admin.
 */
const isAdmin = window.location.pathname.startsWith('/admin')

if (isAdmin) {
  void import('./admin/entry').then((admin: typeof AdminApp) => {
    Runtime.run(
      Runtime.makeApplication({
        Model: admin.Model,
        init: admin.init,
        update: admin.update,
        view: admin.view,
        subscriptions: admin.subscriptions,
        container: document.getElementById('root'),
        devTools: {
          Message: admin.Message,
        },
      }),
    )
  })
} else {
  void import('./main').then((gallery: typeof GalleryApp) => {
    Runtime.run(
      Runtime.makeApplication({
        Model: gallery.Model,
        init: gallery.init,
        update: gallery.update,
        view: gallery.view,
        subscriptions: gallery.subscriptions,
        container: document.getElementById('root'),
        devTools: {
          Message: gallery.Message,
        },
      }),
    )
  })
}
