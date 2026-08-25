import { Context, Effect, Layer } from 'effect'
import type { HelloResponse } from '@photo/shared'

export interface HelloServiceContract {
  readonly greet: Effect.Effect<HelloResponse, never>
}

export class HelloService extends Context.Service<HelloService, HelloServiceContract>()(
  'HelloService',
) {}

export const HelloServiceLive = Layer.succeed(HelloService, {
  greet: Effect.succeed({ message: 'Hello World' } satisfies HelloResponse),
})
