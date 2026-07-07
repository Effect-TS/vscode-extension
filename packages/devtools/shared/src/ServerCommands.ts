import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Clients from "./DevtoolClients.ts"
import * as Commands from "./DevtoolCommands.ts"

export const ServerCommandsLive = Layer.unwrapScoped(Effect.gen(function*() {
  const clients = yield* Clients.DevtoolClients

  const startServerCommand = Commands.StartServer.toLayer(Effect.gen(function*() {
    return () => {
      return SubscriptionRef.update(clients.running, (_) => _.setRunning(true))
    }
  }))

  const stopServerCommand = Commands.StopServer.toLayer(Effect.gen(function*() {
    return () => {
      return SubscriptionRef.update(clients.running, (_) => _.setRunning(false))
    }
  }))

  return stopServerCommand.pipe(
    Layer.provideMerge(startServerCommand)
  )
}))
