import './styles.css'
import { Runtime } from 'foldkit'

import * as admin from './admin/entry'
import * as gallery from './main'

/**
 * Single SPA entry: `/admin` boots the Admin application, every other path
 * boots the public gallery.
 */
if (window.location.pathname.startsWith('/admin')) {
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
} else {
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
}
