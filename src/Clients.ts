import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Server from "@effect/experimental/DevTools/Server"
import * as NodeSocketServer from "@effect/platform-node/NodeSocketServer"
import * as SocketServer from "@effect/platform/SocketServer"
import * as Array from "effect/Array"
import * as Cause from "effect/Cause"
import * as Chunk from "effect/Chunk"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Fiber from "effect/Fiber"
import * as FiberHandle from "effect/FiberHandle"
import { pipe } from "effect/Function"
import * as Hash from "effect/Hash"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import * as DebugChannel from "./DebugChannel"
import * as DebugEnv from "./DebugEnv"
import type { ConfigRef } from "./VsCode"
import { configWithDefault, executeCommand, listenFork, registerCommand } from "./VsCode"

export interface Client extends Equal.Equal {
  readonly id: number
  readonly name: string
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

const DebugInstrumentationResponseSchema = Schema.parseJson(Schema.Struct({
  instrumentationId: Schema.String,
  responses: Schema.Array(Domain.Request)
}))

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

const makeClient = (serverClient: Server.Client, name?: string) =>
  Effect.gen(function*() {
    const { activeClient, clientId, clients } = yield* ClientsContext

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
      name: name ?? `Client #${id}`,
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

const runServer = (port: number) =>
  Effect.gen(function*() {
    const { clients, running } = yield* ClientsContext

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
      Effect.interruptible,
      Effect.provideService(ClientsContext, yield* ClientsContext)
    )

    yield* Stream.runForEach(clients.changes, (client) =>
      Effect.gen(function*() {
        yield* executeCommand("setContext", "effect:hasClients", HashSet.size(client) > 0)
      })).pipe(Effect.forkScoped)

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
      const pollMillis = yield* configWithDefault(
        "effect.tracer",
        "pollInterval",
        250
      )
      const scope = yield* Effect.scope

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

      // keeps a list of known debug sessions and those already attached to a client
      const debugSessions = new Set<vscode.DebugSession>()
      const attachedDebugSessions = new Set<vscode.DebugSession>()
      yield* listenFork(vscode.debug.onDidStartDebugSession, (session) => Effect.sync(() => debugSessions.add(session)))
      yield* listenFork(
        vscode.debug.onDidTerminateDebugSession,
        (session) =>
          Effect.sync(() => {
            debugSessions.delete(session)
            attachedDebugSessions.delete(session)
          })
      )

      const clientsContext = yield* ClientsContext
      const attachDebugSessionClient = (session: vscode.DebugSession) =>
        Effect.gen(function*() {
          // do not double attach
          if (attachedDebugSessions.has(session)) return

          // create a debug channel for the session
          const debugChannel = yield* DebugChannel.makeVsCodeDebugSession(session)
          const queue = yield* Mailbox.make<Domain.Request, never>({
            capacity: 200,
            strategy: "sliding"
          })
          const toSend = yield* Queue.unbounded<Domain.Response>()

          // inject the instrumentation into the debug session
          yield* DebugEnv.ensureInstrumentationInjected.pipe(
            Effect.provideService(DebugChannel.DebugChannel, debugChannel)
          )

          // a fiber that takes requests to send to the client or pulls every interval
          const sendReceiveFiber = yield* pipe(
            Queue.takeBetween(toSend, 1, 100),
            Effect.raceFirst(
              Effect.flatMap(
                pollMillis.get,
                (millis) => Effect.sleep(millis).pipe(Effect.as(Chunk.empty<Domain.Response>()))
              )
            ),
            Effect.flatMap((requests) =>
              Effect.gen(function*() {
                const encodedRequests = yield* Schema.encode(Schema.Array(Domain.Response))(Chunk.toArray(requests))
                const requestJs = `globalThis["effect/devtools/instrumentation"].debugProtocolDevtoolsClient(${
                  JSON.stringify(encodedRequests)
                })`
                const debugResponses = yield* DebugChannel.DebugChannel.evaluate(requestJs)

                const result = yield* debugResponses.parse(DebugInstrumentationResponseSchema)
                return yield* queue.offerAll(result.responses)
              })
            ),
            Effect.ignoreLogged,
            Effect.forever,
            Effect.provideService(DebugChannel.DebugChannel, debugChannel),
            Effect.forkIn(scope)
          )

          // kill the client upon session termination
          yield* listenFork(
            vscode.debug.onDidTerminateDebugSession,
            (terminatedSession) =>
              terminatedSession.id === session.id
                ? Effect.zipRight(Fiber.interrupt(sendReceiveFiber), queue.shutdown)
                : Effect.void
          )

          yield* Effect.sync(() => attachedDebugSessions.add(session))

          yield* makeClient({
            queue: queue as any,
            request: (_) => toSend.offer(_)
          }, session.name)
        }).pipe(
          Effect.provideService(ClientsContext, clientsContext),
          Effect.ignoreLogged,
          Effect.scoped,
          Effect.forkIn(scope)
        )

      yield* registerCommand(
        "effect.attachDebugSessionClient",
        () => {
          // heuristic that places before clients with ".ts" in the name
          const sessions = Array.fromIterable(debugSessions)
          sessions.sort((a, b) => {
            const aTs = a.name.includes(".ts")
            const bTs = b.name.includes(".ts")
            if (aTs && !bTs) return -1
            if (!aTs && bTs) return 1
            return 0
          })
          // attach them
          return Effect.forEach(sessions, attachDebugSessionClient)
        }
      )

      return { clients, running, activeClient } as const
    }),
    dependencies: [ClientsContext.Live]
  }
) {}
