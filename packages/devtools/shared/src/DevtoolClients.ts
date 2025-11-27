import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as HashSet from "effect/HashSet"
import type * as Mailbox from "effect/Mailbox"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import type { Dequeue } from "effect/Queue"
import * as Ref from "effect/Ref"
import type { Scope } from "effect/Scope"
import * as SubscriptionRef from "effect/SubscriptionRef"

export interface ServerClient {
  readonly queue: Mailbox.ReadonlyMailbox<Domain.Request.WithoutPing>
  readonly request: (_: Domain.Response.WithoutPong) => Effect.Effect<void>
}

export interface Client extends Equal.Equal {
  readonly id: number
  readonly name: string
  readonly spans: Effect.Effect<
    Dequeue<Domain.Span | Domain.SpanEvent>,
    never,
    Scope
  >
  readonly metrics: Effect.Effect<Dequeue<Domain.MetricsSnapshot>, never, Scope>
  readonly requestMetrics: Effect.Effect<void>
}

export class RunningState extends Data.TaggedClass("RunningState")<{
  readonly running: boolean
  readonly cause: Cause.Cause<unknown>
  readonly port: number
}> {
  setRunning(running: boolean) {
    return new RunningState({ ...this, cause: Cause.empty, running })
  }
  setPort(port: number) {
    return new RunningState({ ...this, port })
  }
}

export class DevtoolClients extends Effect.Service<DevtoolClients>()("effect-vscode/devtools/DevtoolClients", {
  scoped: Effect.gen(function*() {
    const clients = yield* SubscriptionRef.make(HashSet.empty<Client>())
    const running = yield* SubscriptionRef.make(
      new RunningState({
        running: false,
        cause: Cause.empty,
        port: 0
      })
    )
    const activeClient = yield* SubscriptionRef.make(Option.none<Client>())
    const clientId = yield* Ref.make(1)

    const makeClient = (serverClient: ServerClient, name?: string) =>
      Effect.gen(function*() {
        const spans = yield* Effect.acquireRelease(
          PubSub.sliding<Domain.Span | Domain.SpanEvent>({
            capacity: 100
          }),
          PubSub.shutdown
        )
        const metrics = yield* Effect.acquireRelease(
          PubSub.sliding<Domain.MetricsSnapshot>({
            capacity: 2
          }),
          PubSub.shutdown
        )
        const id = yield* Ref.getAndUpdate(clientId, (_) => _ + 1)
        const client: Client = {
          id,
          name: name ?? `Client #${id}`,
          spans: PubSub.subscribe(spans),
          metrics: PubSub.subscribe(metrics),
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

    return ({
      clients,
      running,
      activeClient,
      clientId,
      makeClient
    })
  })
}) {}
