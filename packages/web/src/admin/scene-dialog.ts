/**
 * The Scene steps a Dialog submodel needs answered when it opens and when it
 * closes. Show, paint, acquire and close are the Dialog's and Animation's own
 * business rather than the app's Messages, so a scene has to answer them or
 * the simulation stalls on an unresolved Command.
 *
 * Animation stamps every Command it dispatches with the transition generation
 * it scheduled, and `update` drops results from any other generation, so each
 * answer has to carry the generation the Model is actually on. A Model starts
 * at 0, the open makes it 1, and the close that follows makes it 2.
 */

import { Scene } from 'foldkit'
import * as Animation from '@foldkit/ui/animation'
import { AcquireResources, CloseDialog, ShowDialog } from '@foldkit/ui/dialog'

import * as Dialog from '@/components/ui/dialog'

/** The paint and settle of one transition of the panel `id` opens. */
const transition = (id: string, generation: number) => [
  Scene.Command.resolve(
    Animation.WaitForPaint({ generation }),
    Animation.Message.CompletedWaitForPaint({ generation }),
  ),
  Scene.Command.resolve(
    Animation.WaitForAnimationSettled({ id: `${id}-panel`, generation }),
    Animation.Message.EndedAnimation({ generation }),
  ),
]

/** Opens `id`, paints and settles its panel, then hands it its resources. */
export const dialogOpened = (id: string) => [
  Scene.Command.resolve(
    ShowDialog({ id, focusSelector: '[data-foldkit-dialog-initial-focus]' }),
    Dialog.Message.SucceededShowDialog(),
  ),
  ...transition(id, 1),
  Scene.Mount.resolve(AcquireResources, Dialog.Message.SucceededAcquireResources()),
]

/** Leaves the panel `id` opened on, then closes it. */
export const dialogClosed = (id: string) => [
  ...transition(id, 2),
  Scene.Command.resolve(CloseDialog({ id }), Dialog.Message.CompletedCloseDialog()),
]
