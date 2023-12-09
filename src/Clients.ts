import * as Server from "@effect/experimental/DevTools/Server"
import * as Domain from "@effect/experimental/DevTools/Domain"
import {
  Context,
  Effect,
  HashSet,
  Layer,
  Option,
  PubSub,
  Queue,
  ReadonlyArray,
  Schedule,
  Scope,
  SubscriptionRef,
} from "effect"
import * as SocketServer from "@effect/experimental/SocketServer/Node"
import { registerCommand } from "./VsCode"

export interface Client {
  readonly id: number
  readonly spans: Queue.Dequeue<Domain.Span>
}

const make = Effect.gen(function* (_) {
  const server = yield* _(Server.make)
  const clients = yield* _(SubscriptionRef.make(HashSet.empty<Client>()))
  const activeClient = yield* _(SubscriptionRef.make(Option.none<Client>()))
  let clientId = 1

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
    server.clients.take,
    Effect.flatMap(queue =>
      Effect.gen(function* (_) {
        const spans = yield* _(Queue.sliding<Domain.Span>(100))
        const client: Client = {
          id: clientId++,
          spans,
        }
        yield* _(SubscriptionRef.update(clients, HashSet.add(client)))
        yield* _(
          queue.take,
          Effect.flatMap(_ => spans.offer(_)),
          Effect.forever,
          Effect.ensuring(
            SubscriptionRef.update(clients, HashSet.remove(client)).pipe(
              Effect.zipRight(
                SubscriptionRef.update(
                  activeClient,
                  Option.filter(_ => _ !== client),
                ),
              ),
              Effect.zipRight(spans.shutdown),
            ),
          ),
          Effect.fork,
        )
      }),
    ),
    Effect.forever,
    Effect.forkScoped,
  )

  yield* _(
    server.run,
    Effect.tapErrorCause(Effect.log),
    Effect.retry(Schedule.spaced("10 seconds")),
    Effect.forkScoped,
  )

  return { clients, activeClient } as const
})

export interface Clients {
  readonly _: unique symbol
}
export const Clients = Context.Tag<Clients, Effect.Effect.Success<typeof make>>(
  "effect-vscode/Clients",
)
export const ClientsLive = Layer.scoped(Clients, make).pipe(
  Layer.provide(SocketServer.layerWebSocket({ port: 34437 })),
)
