import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as Graph from "effect/Graph"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as ExtWebView from "./core/ExtWebView.ts"
import * as Clients from "./DevtoolClients.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as WebViewMessage from "./webviews/tracer.generated.ts"

interface GraphNodeInfo {
  readonly span: Domain.ParentSpan
  readonly events: Array<Domain.SpanEvent>
}

export type SpanGraph = Graph.MutableGraph<GraphNodeInfo, void>
export type SpanGraphInfo = {
  readonly graph: SpanGraph
  readonly nodeIdBySpanId: Map<string, number>
}

export const ClientTracerWebView = ExtWebView.make("effect-tracer-extended", {
  title: "Tracer",
  type: "tracer"
})

export const ClientTracerWebViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const resetHub = yield* PubSub.sliding<void>({ capacity: 2 })
  const clients = yield* Clients.DevtoolClients
  const graphByTraceId = new Map<string, SpanGraphInfo>()
  let usedRange = Option.none<[bigint, bigint]>()

  function ensureSpan(traceId: string, spanId: string): [SpanGraph, number] {
    let info = graphByTraceId.get(traceId)
    if (info === undefined) {
      info = {
        graph: Graph.beginMutation(Graph.directed<GraphNodeInfo, void>()),
        nodeIdBySpanId: new Map<string, number>()
      }
      graphByTraceId.set(traceId, info)
    }
    let nodeId = info.nodeIdBySpanId.get(spanId)
    if (nodeId === undefined) {
      nodeId = Graph.addNode(info.graph, {
        span: Domain.ExternalSpan.make({ _tag: "ExternalSpan", spanId, traceId, sampled: false }),
        events: []
      })
      info.nodeIdBySpanId.set(spanId, nodeId)
    }
    return [info.graph, nodeId]
  }

  function countParentSpans(span: Domain.ParentSpan): number {
    let current = Option.some(span)
    let count = 0
    while (Option.isSome(current) && current.value._tag === "Span") {
      current = Option.flatMap(
        current,
        (current) => current._tag === "Span" ? (current.parent) : Option.none()
      )
      count++
    }
    return count
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
    const [mutableGraph, nodeId] = ensureSpan(span.traceId, span.spanId)
    Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
      const [latestInfo, upgraded] = sortSpan(previousInfo.span, span)
      if (upgraded && latestInfo._tag === "Span" && Option.isSome(latestInfo.parent)) {
        const parentNodeId = addNode(latestInfo.parent.value)
        Graph.addEdge(mutableGraph, parentNodeId, nodeId, undefined)
      }
      if (latestInfo._tag === "Span") {
        const lowestStart = pipe(
          usedRange,
          Option.map(([startTime]) => startTime),
          Option.map((startTime) => startTime < latestInfo.status.startTime ? startTime : latestInfo.status.startTime),
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
    return nodeId
  }

  function addEvent(event: Domain.SpanEvent) {
    const [mutableGraph, nodeId] = ensureSpan(event.traceId, event.spanId)
    Graph.updateNode(mutableGraph, nodeId, (previousInfo) => {
      return { ...previousInfo, events: [...previousInfo.events, event] }
    })
    return nodeId
  }

  const handleClient = (client: Clients.Client) =>
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

  const resetTracer = DevtoolCommands.ResetTracerExtended.toLayer(
    Effect.succeed(() => PubSub.publish(resetHub, void 0))
  )

  const treeView = ClientTracerWebView.toLayer((send, queue) =>
    Effect.gen(function*() {
      const request = (message: WebViewMessage.InMessage) =>
        Schema.encodeUnknown(WebViewMessage.InMessage)(message).pipe(
          Effect.flatMap(send),
          Effect.ignoreLogged
        )

      yield* queue.take.pipe(
        Effect.flatMap(Schema.decodeUnknown(WebViewMessage.OutMessage)),
        Effect.flatMap((message) =>
          Effect.gen(function*() {
            switch (message._tag) {
              case "UsedRangeRequest": {
                const range = pipe(
                  usedRange,
                  Option.map(([startTime, endTime]) => new WebViewMessage.UsedRangeInfo({ startTime, endTime })),
                  Option.getOrElse(() =>
                    new WebViewMessage.UsedRangeInfo({ startTime: BigInt(1), endTime: BigInt(-1) })
                  )
                )
                return yield* request(
                  range
                )
              }
              case "TraceListRequest": {
                return yield* request(
                  new WebViewMessage.TraceListInfo({ traceIds: Array.fromIterable(graphByTraceId.keys()) })
                )
              }
              case "SpanListRequest": {
                const graphs = Array.fromIterable(graphByTraceId.entries()).filter(([traceId]) =>
                  Option.isNone(message.traceId) || Equal.equals(message.traceId, Option.some(traceId))
                )
                const spanIds = pipe(
                  Array.fromIterable(graphs),
                  Array.map(([traceId, info]) => {
                    const spanIds: Array<WebViewMessage.SpanId> = []
                    const rootIds = pipe(
                      Graph.externals(info.graph, { direction: "incoming" }),
                      Graph.indices,
                      Array.fromIterable
                    )
                    for (
                      const [_o, _] of Graph.dfs(info.graph, {
                        start: rootIds,
                        direction: "outgoing"
                      })
                    ) {
                      spanIds.push(new WebViewMessage.SpanId({ traceId, spanId: _.span.spanId }))
                    }
                    return spanIds
                  }),
                  Array.flatten
                )
                return yield* request(
                  new WebViewMessage.SpanListInfo({
                    traceId: message.traceId,
                    spanIds
                  })
                )
              }
              case "SpanDataForListRequest": {
                const maybeInfo = pipe(
                  Option.fromNullable(graphByTraceId.get(message.spanId.traceId)),
                  Option.flatMap((graph) =>
                    Option.fromNullable(graph.nodeIdBySpanId.get(message.spanId.spanId)).pipe(
                      Option.flatMap((nodeId) => Graph.getNode(graph.graph, nodeId)),
                      Option.map((info) =>
                        new WebViewMessage.SpanDataForListInfo({
                          spanId: message.spanId,
                          name: Option.fromNullable(info.span._tag === "Span" ? info.span.name : undefined),
                          depth: countParentSpans(info.span),
                          startTime: Option.fromNullable(
                            info.span._tag === "Span" ? info.span.status.startTime : undefined
                          ),
                          endTime: Option.fromNullable(
                            info.span._tag === "Span" && info.span.status._tag === "Ended"
                              ? info.span.status.endTime
                              : undefined
                          )
                        })
                      )
                    )
                  )
                )
                return yield* request(Option.getOrElse(maybeInfo, () =>
                  new WebViewMessage.SpanDataForListInfo({
                    spanId: message.spanId,
                    depth: 0,
                    name: Option.none(),
                    startTime: Option.none(),
                    endTime: Option.none()
                  })))
              }
            }
          })
        ),
        Effect.ignoreLogged,
        Effect.forever,
        Effect.forkScoped
      )
    })
  )

  return treeView.pipe(Layer.provideMerge(resetTracer))
}))
