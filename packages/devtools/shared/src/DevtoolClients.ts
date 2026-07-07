import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as Function from "effect/Function"
import * as Graph from "effect/Graph"
import * as Hash from "effect/Hash"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Layer from "effect/Layer"
import type * as Mailbox from "effect/Mailbox"
import * as MutableHashMap from "effect/MutableHashMap"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import type { Dequeue } from "effect/Queue"
import * as Ref from "effect/Ref"
import type { Scope } from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as DevtoolSpanCollector from "./DevtoolSpanCollector.ts"

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

export const layerSpanCollector = Layer.scoped(
  DevtoolSpanCollector.ClientsSpanGraphCollector,
  Effect.gen(function*() {
    const clients = yield* DevtoolClients
    const nodeIndexBySpanAndTraceId = MutableHashMap.empty<DevtoolSpanCollector.SpanAndTraceId, Graph.NodeIndex>()
    const graph = Graph.beginMutation(Graph.directed<DevtoolSpanCollector.GraphNodeInfo, void>())
    const traceIds = new Set<string>()
    let usedRange = Option.none<[bigint, bigint]>()

    function ensureSpan(traceId: string, spanId: string): Graph.NodeIndex {
      const spanAndTraceId = DevtoolSpanCollector.SpanAndTraceId.make({ traceId, spanId })
      const maybeNodeIndex = MutableHashMap.get(nodeIndexBySpanAndTraceId, spanAndTraceId)
      let nodeIndex: Graph.NodeIndex
      if (Option.isNone(maybeNodeIndex)) {
        nodeIndex = Graph.addNode(graph, {
          span: Domain.ExternalSpan.make({ _tag: "ExternalSpan", spanId, traceId, sampled: false }),
          events: []
        })
        MutableHashMap.set(nodeIndexBySpanAndTraceId, spanAndTraceId, nodeIndex)
      } else {
        nodeIndex = maybeNodeIndex.value
      }
      return nodeIndex
    }

    function sortSpan(
      prev: Domain.ParentSpan,
      next: Domain.ParentSpan
    ): [info: Domain.ParentSpan, isUpgrade: boolean, timingUpdated: boolean] {
      if (prev._tag === "ExternalSpan" && next._tag === "Span") return [next, true, true]
      if (prev._tag === "Span" && next._tag === "Span" && next.status._tag === "Ended") return [next, false, true]
      return [prev, false, false]
    }

    function addNode(span: Domain.ParentSpan) {
      const nodeIndex = ensureSpan(span.traceId, span.spanId)
      Graph.updateNode(graph, nodeIndex, (previousInfo) => {
        const [latestInfo, upgraded] = sortSpan(previousInfo.span, span)
        if (upgraded && latestInfo._tag === "Span" && Option.isSome(latestInfo.parent)) {
          const parentNodeId = addNode(latestInfo.parent.value)
          Graph.addEdge(graph, parentNodeId, nodeIndex, undefined)
        }
        if (latestInfo !== previousInfo.span && latestInfo._tag === "Span") {
          const lowestStart = pipe(
            usedRange,
            Option.map(([startTime]) => startTime),
            Option.map((startTime) =>
              startTime < latestInfo.status.startTime ? startTime : latestInfo.status.startTime
            ),
            Option.getOrElse(() => (latestInfo.status.startTime))
          )
          const highestEnd = pipe(
            usedRange,
            Option.map(([_, endTime]) => endTime),
            Option.orElse(() => Option.some(latestInfo.status.startTime)),
            Option.map((endTime) =>
              latestInfo.status._tag === "Ended" && endTime < latestInfo.status.endTime
                ? latestInfo.status.endTime
                : endTime
            ),
            Option.getOrElse(() => (latestInfo.status.startTime))
          )
          usedRange = Option.some([lowestStart, highestEnd])
        }
        return { ...previousInfo, span: latestInfo }
      })
      return nodeIndex
    }

    function addEvent(event: Domain.SpanEvent) {
      const nodeIndex = ensureSpan(event.traceId, event.spanId)
      Graph.updateNode(graph, nodeIndex, (previousInfo) => {
        return { ...previousInfo, events: [...previousInfo.events, event] }
      })
      return nodeIndex
    }

    const handleClient = (client: Client) =>
      Effect.gen(function*() {
        const spans = yield* client.spans
        return yield* spans.take.pipe(
          Effect.map((_) => {
            switch (_._tag) {
              case "Span": {
                return addNode(_)
              }
              case "SpanEvent": {
                return addEvent(_)
              }
            }
          }),
          Effect.ignoreLogged,
          Effect.forever
        )
      }).pipe(Effect.scoped)

    yield* clients.clients.changes.pipe(
      Stream.flatMap(
        Effect.forEach(handleClient, { concurrency: "unbounded" }),
        { switch: true }
      ),
      Stream.runDrain,
      Effect.forkScoped
    )

    return Function.identity<typeof DevtoolSpanCollector.ClientsSpanGraphCollector.Service>({
      usedRange: Effect.sync(() => usedRange),
      traceIds: Effect.sync(() => Array.from(traceIds)),
      graphByTraceId: Effect.sync(() => ({
        graph: Graph.endMutation(graph),
        nodeIndexBySpanAndTraceId: HashMap.make(...Array.from(nodeIndexBySpanAndTraceId))
      }))
    })
  })
)
