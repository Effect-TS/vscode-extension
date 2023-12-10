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
import { configWithDefault, executeCommand, registerCommand } from "./VsCode"

export interface Client {
  readonly id: number
  readonly spans: Queue.Dequeue<Domain.Span>
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

const runServer = ({
  clients,
  activeClient,
  running,
  clientId,
}: {
  readonly clients: SubscriptionRef.SubscriptionRef<HashSet.HashSet<Client>>
  readonly activeClient: SubscriptionRef.SubscriptionRef<Option.Option<Client>>
  readonly running: SubscriptionRef.SubscriptionRef<RunningState>
  readonly clientId: Ref.Ref<number>
}) =>
  Effect.gen(function* (_) {
    const server = yield* _(Server.make)

    const take = Effect.gen(function* (_) {
      const queue = yield* _(server.clients.take)
      const spans = yield* _(Queue.sliding<Domain.Span>(100))
      const id = yield* _(Ref.getAndUpdate(clientId, _ => _ + 1))
      const client: Client = { id, spans }
      yield* _(SubscriptionRef.update(clients, HashSet.add(client)))
      const removeClient = SubscriptionRef.update(
        clients,
        HashSet.remove(client),
      )

      yield* _(
        SubscriptionRef.update(
          activeClient,
          Option.orElse(() => Option.some(client)),
        ),
      )
      const removeIfActive = SubscriptionRef.update(
        activeClient,
        Option.filter(_ => _ !== client),
      )

      return yield* _(
        queue.take,
        Effect.flatMap(_ => spans.offer(_)),
        Effect.forever,
        Effect.ensuring(
          Effect.all([spans.shutdown, removeClient, removeIfActive]),
        ),
        Effect.fork,
      )
    }).pipe(Effect.forever)

    const fiber = yield* _(ScopedRef.make(() => Fiber.unit))
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
          yield* _(
            ScopedRef.set(fiber, running ? run : Effect.succeed(Fiber.unit)),
          )
          yield* _(executeCommand("setContext", "effect:running", running))
        }),
      ),
      Effect.forkScoped,
    )
  })

const make = Effect.gen(function* (_) {
  const clients = yield* _(SubscriptionRef.make(HashSet.empty<Client>()))
  const port = yield* _(configWithDefault("effect", "devServerPort", 34437))
  const running = yield* _(
    SubscriptionRef.make(
      new RunningState({
        running: false,
        cause: Cause.empty,
        port: yield* _(SubscriptionRef.get(port)),
      }),
    ),
  )
  const activeClient = yield* _(SubscriptionRef.make(Option.none<Client>()))
  const clientId = yield* _(Ref.make(1))

  const makeServer = Effect.provideServiceEffect(
    runServer({ clients, activeClient, running, clientId }),
    SocketServer.SocketServer,
    Effect.flatMap(SubscriptionRef.get(port), port =>
      SocketServer.makeWebSocket({ port }),
    ),
  )
  const server = yield* _(ScopedRef.fromAcquire(makeServer))
  yield* _(
    port.changes,
    Stream.changes,
    Stream.drop(1),
    Stream.tap(port => SubscriptionRef.update(running, _ => _.setPort(port))),
    Stream.runForEach(() => ScopedRef.set(server, makeServer)),
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
export const ClientsLive = Layer.scoped(Clients, make)
