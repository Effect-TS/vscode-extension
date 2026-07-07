import * as Clients_ from "@effect/devtools-shared/DevtoolClients"
import * as Configs from "@effect/devtools-shared/DevtoolConfigs"
import * as Inputs from "@effect/devtools-shared/DevtoolInputs"
import * as Server from "@effect/experimental/DevTools/Server"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as SocketServer from "@effect/platform/SocketServer"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"

const runServer = (port: number) =>
  Effect.gen(function*() {
    const { clients, makeClient, running } = yield* Clients_.DevtoolClients
    const setHasClients = yield* Inputs.hasClients
    const setRunning = yield* Inputs.running

    const run = Server.run(makeClient).pipe(
      Effect.provideServiceEffect(
        SocketServer.SocketServer,
        NodeSocketServer.makeWebSocket({ port })
      ),
      Effect.scoped,
      Effect.catchAllCause((cause) =>
        SubscriptionRef.update(
          running,
          (_) => new Clients_.RunningState({ ..._, running: false, cause })
        )
      ),
      Effect.interruptible
    )

    yield* Stream.runForEach(
      clients.changes,
      (client) => setHasClients(HashSet.size(client) > 0)
    ).pipe(
      Effect.asVoid,
      Effect.forkScoped
    )

    const serverHandle = yield* FiberHandle.make()
    yield* Stream.runForEach(running.changes, ({ running }) =>
      Effect.gen(function*() {
        yield* running
          ? FiberHandle.run(serverHandle, run, { onlyIfMissing: true })
          : FiberHandle.clear(serverHandle)
        yield* setRunning(running)
      }))
  }).pipe(Effect.scoped)

export const ClientsLive = Layer.scopedDiscard(
  Effect.gen(function*() {
    const { running } = yield* Clients_.DevtoolClients
    const port = yield* Configs.DevServerPort

    const server = yield* FiberHandle.make()
    yield* port.changes.pipe(
      Stream.tap((port) => SubscriptionRef.update(running, (_) => _.setPort(port))),
      Stream.runForEach((port) => FiberHandle.run(server, runServer(port))),
      Effect.forkScoped
    )
  })
)
