import './styles.css'
import { Effect } from 'effect'
import { Runtime } from 'foldkit'
import type * as AdminApp from './admin/entry'
import type * as GalleryApp from './main'
import { rpcPublic } from '@/lib/rpc'
import type { PhotoWithTags } from '@photo/shared'

/**
 * Single SPA entry with route-based code splitting: `/admin` loads the Admin
 * bundle, every other path loads the public gallery. Visitors never ship
 * the admin Sheet/Dialog/FileDrop/combobox unless they visit /admin.
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
  void import('./main').then((gallery: typeof GalleryApp) => {
    const program = Runtime.makeApplication({
      Model: gallery.Model,
      Flags: gallery.Flags,
      init: gallery.init,
      update: gallery.update,
      view: gallery.view,
      subscriptions: gallery.subscriptions,
      container: document.getElementById('root'),
      devTools: {
        Message: gallery.Message,
      },
    })
    const isHydratable = document.querySelector('[data-foldkit-app]') !== null
    if (isHydratable) {
      Runtime.hydrate(program, { buildId: import.meta.env.FOLDKIT_BUILD_ID })
    } else {
      interface PhotoPage {
        readonly items: ReadonlyArray<PhotoWithTags>
        readonly nextCursor: string | null
      }
      const flags = Effect.map(rpcPublic<PhotoPage>('ListPhotos', { limit: 60 }), (page) => ({
        photos: [...page.items],
        nextCursor: page.nextCursor,
      })).pipe(
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- null typed as string|null for Flags nextCursor
        Effect.catch(() =>
          Effect.succeed({ photos: [], nextCursor: null as unknown as string | null }),
        ),
      )
      Runtime.run(program, { flags })
    }
  })
}
