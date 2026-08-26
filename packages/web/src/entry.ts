// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- route-based code splitting requires dynamic import()
// oxlint-disable-next-line import-type -- dynamic import is intentional for bundle splitting
import './styles.css'
import { Runtime } from 'foldkit'

/**
 * Single SPA entry with route-based code splitting: `/admin` loads the Admin
 * bundle, every other path loads the public gallery. Visitors never ship
 * the admin Sheet/Dialog/FileDrop/combobox unless they visit /admin.
 */
const isAdmin = window.location.pathname.startsWith('/admin')

if (isAdmin) {
  void import('./admin/entry').then((admin) => {
    Runtime.run(
      Runtime.makeApplication({
        Model: admin.Model,
        init: admin.init,
        update: admin.update,
        view: admin.view,
        container: document.getElementById('root'),
        devTools: {
          Message: admin.Message,
        },
      }),
    )
  })
} else {
  void import('./main').then((gallery) => {
    Runtime.run(
      Runtime.makeApplication({
        Model: gallery.Model,
        init: gallery.init,
        update: gallery.update,
        view: gallery.view,
        container: document.getElementById('root'),
        devTools: {
          Message: gallery.Message,
        },
      }),
    )
  })
}
