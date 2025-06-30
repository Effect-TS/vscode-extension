import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Server from "@effect/experimental/DevTools/Server"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as SocketServer from "@effect/platform/SocketServer"
import * as Array from "effect/Array"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as FiberHandle from "effect/FiberHandle"
import * as Hash from "effect/Hash"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { ConfigRef } from "./VsCode"
import { configWithDefault, executeCommand, registerCommand } from "./VsCode"

export interface Client extends Equal.Equal {
  readonly id: number
  readonly spans: Mailbox.ReadonlyMailbox<Domain.Span | Domain.SpanEvent>
  readonly metrics: Mailbox.ReadonlyMailbox<Domain.MetricsSnapshot>
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
  "effect-vscode/Clients/ClientsContext"
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
    Effect.gen(function*() {
      const clients = yield* SubscriptionRef.make(HashSet.empty<Client>())
      const port = yield* configWithDefault("effect.devServer", "port", 34437)
      const running = yield* SubscriptionRef.make(
        new RunningState({
          running: false,
          cause: Cause.empty,
          port: yield* port.get
        })
      )
      const activeClient = yield* SubscriptionRef.make(Option.none<Client>())
      const clientId = yield* Ref.make(1)
      return ClientsContext.of({
        clients,
        running,
        activeClient,
        clientId,
        port
      })
    })
  )
}

const runServer = (port: number) =>
  Effect.gen(function*() {
    const { activeClient, clientId, clients, running } = yield* ClientsContext

    const makeClient = (serverClient: Server.Client) =>
      Effect.gen(function*() {
        const spans = yield* Effect.acquireRelease(
          Mailbox.make<Domain.Span | Domain.SpanEvent>({
            capacity: 100,
            strategy: "sliding"
          }),
          (mailbox) => mailbox.end
        )
        const metrics = yield* Effect.acquireRelease(
          Mailbox.make<Domain.MetricsSnapshot>({
            capacity: 2,
            strategy: "sliding"
          }),
          (mailbox) => mailbox.end
        )
        const id = yield* Ref.getAndUpdate(clientId, (_) => _ + 1)
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
          }
        }
        yield* Effect.acquireRelease(
          SubscriptionRef.update(clients, HashSet.add(client)),
          () => SubscriptionRef.update(clients, HashSet.remove(client))
        )
        yield* Effect.acquireRelease(
          SubscriptionRef.update(
            activeClient,
            Option.orElseSome(() => client)
          ),
          () =>
            SubscriptionRef.update(
              activeClient,
              Option.filter((_) => _ !== client)
            )
        )

        yield* serverClient.queue.take.pipe(
          Effect.flatMap((res) => {
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
          Effect.fork
        )
      }).pipe(Effect.awaitAllChildren, Effect.scoped)

    const run = Server.run(makeClient).pipe(
      Effect.provideServiceEffect(
        SocketServer.SocketServer,
        NodeSocketServer.makeWebSocket({ port })
      ),
      Effect.scoped,
      Effect.catchAllCause((cause) =>
        SubscriptionRef.update(
          running,
          (_) => new RunningState({ ..._, running: false, cause })
        )
      ),
      Effect.interruptible
    )

    const serverHandle = yield* FiberHandle.make()
    yield* Stream.runForEach(running.changes, ({ running }) =>
      Effect.gen(function*(_) {
        yield* running
          ? FiberHandle.run(serverHandle, run, { onlyIfMissing: true })
          : FiberHandle.clear(serverHandle)
        yield* executeCommand("setContext", "effect:running", running)
      }))
  }).pipe(Effect.scoped)

export class Clients extends Effect.Service<Clients>()(
  "effect-vscode/Clients",
  {
    scoped: Effect.gen(function*() {
      const { activeClient, clients, port, running } = yield* ClientsContext

      const server = yield* FiberHandle.make()
      yield* port.changes.pipe(
        Stream.tap((port) => SubscriptionRef.update(running, (_) => _.setPort(port))),
        Stream.runForEach((port) => FiberHandle.run(server, runServer(port))),
        Effect.forkScoped
      )

      yield* registerCommand("effect.selectClient", (id: number) =>
        Effect.gen(function*() {
          const current = yield* SubscriptionRef.get(clients)
          const client = Array.findFirst(current, (_) => _.id === id)
          if (client._tag === "None") {
            return
          }
          yield* SubscriptionRef.set(activeClient, client)
        }))

      yield* registerCommand("effect.startServer", () => SubscriptionRef.update(running, (_) => _.setRunning(true)))

      yield* registerCommand("effect.stopServer", () => SubscriptionRef.update(running, (_) => _.setRunning(false)))

      return { clients, running, activeClient } as const
    }),
    dependencies: [ClientsContext.Live]
  }
) {}
