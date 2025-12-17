import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as Graph from "effect/Graph"
import * as HashSet from "effect/HashSet"
import * as Iterable from "effect/Iterable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as ExtWebView from "./core/ExtWebView.ts"
import * as DevtoolCommands from "./DevtoolCommands.ts"
import * as DevtoolSpanCollector from "./DevtoolSpanCollector.ts"
import * as GraphUtils from "./utils/Graph.ts"
import * as WebViewMessage from "./webviews/tracer.generated.ts"

export const ClientTracerWebView = ExtWebView.make("effect-tracer-extended", {
  title: "Tracer",
  type: "tracer"
})

export const ClientTracerWebViewLive = Layer.unwrapScoped(Effect.gen(function*() {
  const resetHub = yield* PubSub.sliding<void>({ capacity: 2 })
  const spanCollector = yield* DevtoolSpanCollector.ClientsSpanGraphCollector

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
                  yield* spanCollector.usedRange,
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
                const graphByTraceId = yield* spanCollector.graphByTraceId
                return yield* request(
                  new WebViewMessage.TraceListInfo({ traceIds: Array.fromIterable(graphByTraceId.keys()) })
                )
              }
              case "SpanListRequest": {
                const graphByTraceId = yield* spanCollector.graphByTraceId
                const graphs = Array.fromIterable(graphByTraceId.entries()).filter(([traceId]) =>
                  Option.isNone(message.traceId) || Equal.equals(message.traceId, Option.some(traceId))
                )
                const explodedSet = HashSet.fromIterable(message.expandedSpanIds)
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
                      const [_o, _] of GraphUtils.dfsChooseContinue(info.graph, {
                        start: rootIds,
                        direction: "outgoing",
                        chooseContinue: (data) =>
                          HashSet.has(
                            explodedSet,
                            new WebViewMessage.SpanId({ traceId: data.span.traceId, spanId: data.span.spanId })
                          )
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
                const graphByTraceId = yield* spanCollector.graphByTraceId
                const maybeInfo = pipe(
                  Option.fromNullable(graphByTraceId.get(message.spanId.traceId)),
                  Option.flatMap((graph) =>
                    Option.fromNullable(graph.nodeIdBySpanId.get(message.spanId.spanId)).pipe(
                      Option.flatMap((nodeId) =>
                        Graph.getNode(graph.graph, nodeId).pipe(
                          Option.map((info) =>
                            new WebViewMessage.SpanDataForListInfo({
                              spanId: message.spanId,
                              name: Option.fromNullable(info.span._tag === "Span" ? info.span.name : undefined),
                              depth: DevtoolSpanCollector.countParentSpans(info.span),
                              hasChildren: !Iterable.isEmpty(Graph.neighborsDirected(graph.graph, nodeId, "outgoing")),
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
                  )
                )
                return yield* request(Option.getOrElse(maybeInfo, () =>
                  new WebViewMessage.SpanDataForListInfo({
                    spanId: message.spanId,
                    depth: 0,
                    hasChildren: false,
                    name: Option.none(),
                    startTime: Option.none(),
                    endTime: Option.none()
                  })))
              }
              case "SpanDataForDetailsRequest": {
                const graphByTraceId = yield* spanCollector.graphByTraceId
                const info = pipe(
                  Option.fromNullable(graphByTraceId.get(message.spanId.traceId)),
                  Option.flatMap((graph) =>
                    Option.fromNullable(graph.nodeIdBySpanId.get(message.spanId.spanId)).pipe(
                      Option.flatMap((nodeId) => Graph.getNode(graph.graph, nodeId)),
                      Option.map((info) => info)
                    )
                  )
                )
                if (Option.isSome(info)) {
                  return yield* request(
                    new WebViewMessage.SpanDataForDetailsInfo({
                      spanId: message.spanId,
                      data: info.value.span,
                      events: info.value.events
                    })
                  )
                }
                return yield* Effect.void
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
