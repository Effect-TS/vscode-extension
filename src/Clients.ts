import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Server from "@effect/experimental/DevTools/Server"
import * as SocketServer from "@effect/experimental/SocketServer/Node"
import {
  Cause,
  Context,
  Data,
  Effect,
  Fiber,
  HashSet,
  Layer,
  Option,
  Queue,
  ReadonlyArray,
  Ref,
  ScopedRef,
  Stream,
  SubscriptionRef,
} from "effect"
import {
  ConfigRef,
  configWithDefault,
  executeCommand,
  registerCommand,
} from "./VsCode"

export interface Client {
  readonly id: number
  readonly spans: Queue.Dequeue<Domain.Span>
  readonly metrics: Queue.Dequeue<Domain.MetricsSnapshot>
  readonly requestMetrics: Effect.Effect<never, never, void>
}

export class RunningState extends Data.TaggedClass("RunningState")<{
  readonly running: boolean
  readonly cause: Cause.Cause<SocketServer.SocketServerError>
  readonly port: number
}> {
  setRunning(running: boolean) {
    return new RunningState({ ...this, cause: Cause.empty, running })
  }
  setPort(port: number) {
    return new RunningState({ ...this, port })
  }
}

interface ClientsContext {
  readonly clients: SubscriptionRef.SubscriptionRef<HashSet.HashSet<Client>>
  readonly activeClient: SubscriptionRef.SubscriptionRef<Option.Option<Client>>
  readonly running: SubscriptionRef.SubscriptionRef<RunningState>
  readonly clientId: Ref.Ref<number>
  readonly port: ConfigRef<number>
}
const ClientsContext = Context.Tag<ClientsContext>(
  "effect-vscode/Clients/ClientsContext",
)
const ClientsContextLive = Layer.scoped(
  ClientsContext,
  Effect.gen(function* (_) {
    const clients = yield* _(SubscriptionRef.make(HashSet.empty<Client>()))
    const port = yield* _(configWithDefault("effect.devServer", "port", 34437))
    const running = yield* _(
      SubscriptionRef.make(
        new RunningState({
          running: false,
          cause: Cause.empty,
          port: yield* _(port.get),
        }),
      ),
    )
    const activeClient = yield* _(SubscriptionRef.make(Option.none<Client>()))
    const clientId = yield* _(Ref.make(1))
    return ClientsContext.of({ clients, running, activeClient, clientId, port })
  }),
)

const runServer = Effect.gen(function* (_) {
  const { clients, activeClient, running, clientId } = yield* _(ClientsContext)
  const server = yield* _(Server.make)

  const makeClient = (serverClient: Server.Client) =>
    Effect.gen(function* (_) {
      const spans = yield* _(
        Effect.acquireRelease(Queue.sliding<Domain.Span>(100), Queue.shutdown),
      )
      const metrics = yield* _(
        Effect.acquireRelease(
          Queue.sliding<Domain.MetricsSnapshot>(2),
          Queue.shutdown,
        ),
      )
      const id = yield* _(Ref.getAndUpdate(clientId, _ => _ + 1))
      const client: Client = {
        id,
        spans,
        metrics,
        requestMetrics: serverClient.request({ _tag: "MetricsRequest" }),
      }
      yield* _(
        Effect.acquireRelease(
          SubscriptionRef.update(clients, HashSet.add(client)),
          () => SubscriptionRef.update(clients, HashSet.remove(client)),
        ),
      )
      yield* _(
        Effect.acquireRelease(
          SubscriptionRef.update(
            activeClient,
            Option.orElse(() => Option.some(client)),
          ),
          () =>
            SubscriptionRef.update(
              activeClient,
              Option.filter(_ => _ !== client),
            ),
        ),
      )

      return yield* _(
        serverClient.queue.take,
        Effect.flatMap(res => {
          switch (res._tag) {
            case "MetricsSnapshot": {
              return metrics.offer(res)
            }
            case "Span": {
              return spans.offer(res)
            }
          }
        }),
        Effect.forever,
      )
    }).pipe(Effect.scoped, Effect.fork)

  const take = server.clients.take.pipe(
    Effect.flatMap(makeClient),
    Effect.forever,
  )

  const serverRef = yield* _(ScopedRef.make(() => {}))
  const run = server.run.pipe(
    Effect.zipRight(take, { concurrent: true }),
    Effect.catchAllCause(cause =>
      SubscriptionRef.update(
        running,
        _ => new RunningState({ ..._, running: false, cause }),
      ),
    ),
    Effect.forkScoped,
  )

  yield* _(
    running.changes,
    Stream.runForEach(({ running }) =>
      Effect.gen(function* (_) {
        yield* _(ScopedRef.set(serverRef, running ? run : Effect.unit))
        yield* _(executeCommand("setContext", "effect:running", running))
      }),
    ),
    Effect.forkScoped,
  )
})

const make = Effect.gen(function* (_) {
  const { clients, activeClient, running, port } = yield* _(ClientsContext)

  const makeServer = (port: number) =>
    Effect.provideServiceEffect(
      runServer,
      SocketServer.SocketServer,
      SocketServer.makeWebSocket({ port }),
    )
  const server = yield* _(ScopedRef.make(() => {}))
  yield* _(
    port.changes,
    Stream.tap(port => SubscriptionRef.update(running, _ => _.setPort(port))),
    Stream.runForEach(port => ScopedRef.set(server, makeServer(port))),
    Effect.forkScoped,
  )

  yield* _(
    registerCommand("effect.selectClient", (id: number) =>
      Effect.gen(function* (_) {
        const current = yield* _(SubscriptionRef.get(clients))
        const client = ReadonlyArray.findFirst(current, _ => _.id === id)
        if (client._tag === "None") {
          return
        }
        yield* _(SubscriptionRef.set(activeClient, client))
      }),
    ),
  )

  yield* _(
    registerCommand("effect.startServer", () =>
      SubscriptionRef.update(running, _ => _.setRunning(true)),
    ),
  )

  yield* _(
    registerCommand("effect.stopServer", () =>
      SubscriptionRef.update(running, _ => _.setRunning(false)),
    ),
  )

  return { clients, running, activeClient } as const
})

export interface Clients {
  readonly _: unique symbol
}
export const Clients = Context.Tag<Clients, Effect.Effect.Success<typeof make>>(
  "effect-vscode/Clients",
)
export const ClientsLive = Layer.scoped(Clients, make).pipe(
  Layer.provide(ClientsContextLive),
)
