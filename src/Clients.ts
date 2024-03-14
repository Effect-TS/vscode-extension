import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Server from "@effect/experimental/DevTools/Server"
import * as SocketServer from "@effect/experimental/SocketServer/Node"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as ReadonlyArray from "effect/ReadonlyArray"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import {
  ConfigRef,
  configWithDefault,
  executeCommand,
  registerCommand,
} from "./VsCode"
import * as FiberMap from "effect/FiberMap"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"

export interface Client extends Equal.Equal {
  readonly id: number
  readonly spans: Queue.Dequeue<Domain.Span | Domain.SpanEvent>
  readonly metrics: Queue.Dequeue<Domain.MetricsSnapshot>
  readonly requestMetrics: Effect.Effect<void>
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

export class ClientsContext extends Context.Tag(
  "effect-vscode/Clients/ClientsContext",
)<
  ClientsContext,
  {
    readonly clients: SubscriptionRef.SubscriptionRef<HashSet.HashSet<Client>>
    readonly activeClient: SubscriptionRef.SubscriptionRef<
      Option.Option<Client>
    >
    readonly running: SubscriptionRef.SubscriptionRef<RunningState>
    readonly clientId: Ref.Ref<number>
    readonly port: ConfigRef<number>
  }
>() {
  static readonly Live = Layer.scoped(
    ClientsContext,
    Effect.gen(function* (_) {
      const clients = yield* _(SubscriptionRef.make(HashSet.empty<Client>()))
      const port = yield* _(
        configWithDefault("effect.devServer", "port", 34437),
      )
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
      return ClientsContext.of({
        clients,
        running,
        activeClient,
        clientId,
        port,
      })
    }),
  )
}

const runServer = Effect.gen(function* (_) {
  const { clients, activeClient, running, clientId } = yield* _(ClientsContext)
  const server = yield* _(Server.make)

  const makeClient = (serverClient: Server.Client) =>
    Effect.gen(function* (_) {
      const spans = yield* _(
        Effect.acquireRelease(
          Queue.sliding<Domain.Span | Domain.SpanEvent>(100),
          Queue.shutdown,
        ),
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
        [Equal.symbol](that: Client) {
          return id === that.id
        },
        [Hash.symbol]() {
          return Hash.number(id)
        },
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
            Option.orElseSome(() => client),
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
            case "SpanEvent":
            case "Span": {
              return spans.offer(res)
            }
          }
        }),
        Effect.forever,
      )
    }).pipe(Effect.scoped)

  const run = server.run(makeClient).pipe(
    Effect.catchAllCause(cause =>
      SubscriptionRef.update(
        running,
        _ => new RunningState({ ..._, running: false, cause }),
      ),
    ),
    Effect.forkScoped,
  )

  const serverFiber = yield* _(FiberMap.make<"server">())
  yield* _(
    running.changes,
    Stream.runForEach(({ running }) =>
      Effect.gen(function* (_) {
        yield* _(
          running
            ? FiberMap.run(serverFiber, "server", run)
            : FiberMap.remove(serverFiber, "server"),
        )
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
  const server = yield* _(FiberMap.make<"server">())
  yield* _(
    port.changes,
    Stream.tap(port => SubscriptionRef.update(running, _ => _.setPort(port))),
    Stream.runForEach(port => FiberMap.run(server, "server", makeServer(port))),
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

export class Clients extends Context.Tag("effect-vscode/Clients")<
  Clients,
  Effect.Effect.Success<typeof make>
>() {
  static readonly Live = Layer.scoped(Clients, make).pipe(
    Layer.provide(ClientsContext.Live),
  )
}
