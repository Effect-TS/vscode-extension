import * as Array from "effect/Array"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import { pipe } from "effect/Function"
import * as Graph from "effect/Graph"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Iterable from "effect/Iterable"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
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

export const ClientTracerWebViewLive = Layer.unwrapScoped(
  Effect.gen(function*() {
    const resetHub = yield* PubSub.sliding<void>({ capacity: 2 })
    const spanCollector = yield* DevtoolSpanCollector.ClientsSpanGraphCollector

    const resetTracer = DevtoolCommands.ResetTracerExtended.toLayer(
      Effect.succeed(() => PubSub.publish(resetHub, void 0))
    )

    const treeView = ClientTracerWebView.toLayer((send, queue) =>
      Effect.gen(function*() {
        let currentGraph: DevtoolSpanCollector.SpanGraphInfo | undefined = undefined
        let currentUsedRange: Option.Option<[bigint, bigint]> | undefined = undefined
        const currentCapture = Effect.gen(function*() {
          if (currentGraph && currentUsedRange) return { graph: currentGraph, usedRange: currentUsedRange }
          const graph = yield* spanCollector.graphByTraceId
          const usedRange = yield* spanCollector.usedRange
          currentGraph = graph
          currentUsedRange = usedRange
          return { graph, usedRange }
        })

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
                case "RefreshRequest": {
                  currentGraph = undefined
                  return yield* currentCapture
                }
                case "UsedRangeRequest": {
                  const { usedRange } = yield* currentCapture
                  const range = pipe(
                    usedRange,
                    Option.map(
                      ([startTime, endTime]) =>
                        new WebViewMessage.UsedRangeInfo({
                          startTime,
                          endTime
                        })
                    ),
                    Option.getOrElse(
                      () =>
                        new WebViewMessage.UsedRangeInfo({
                          startTime: BigInt(1),
                          endTime: BigInt(-1)
                        })
                    )
                  )
                  return yield* request(range)
                }
                case "TraceListRequest": {
                  const traceIds = yield* spanCollector.traceIds
                  return yield* request(
                    new WebViewMessage.TraceListInfo({ traceIds })
                  )
                }
                case "SpanListRequest": {
                  const { graph: info } = yield* currentCapture
                  const explodedSet = HashSet.fromIterable(
                    message.expandedSpanIds
                  )
                  const spanIds: Array<WebViewMessage.SpanId> = []
                  const spanOrder = Order.mapInput(
                    Order.bigint,
                    (nodeIndex: Graph.NodeIndex) => {
                      const nodeInfo = info.graph.nodes.get(nodeIndex)!
                      return nodeInfo.span._tag === "Span"
                        ? nodeInfo.span.status.startTime
                        : BigInt(0)
                    }
                  )

                  const rootIds = pipe(
                    Graph.externals(info.graph, { direction: "incoming" }),
                    Graph.indices,
                    Array.fromIterable,
                    Array.filter(
                      (index) =>
                        Option.isNone(message.traceId) ||
                        Equal.equals(
                          message.traceId,
                          Option.some(
                            info.graph.nodes.get(index)?.span.traceId
                          )
                        )
                    )
                  )
                  for (
                    const [_o, _] of GraphUtils.dfsChooseContinue(
                      info.graph,
                      {
                        start: rootIds,
                        direction: "outgoing",
                        order: spanOrder,
                        chooseContinue: (data) =>
                          HashSet.has(
                            explodedSet,
                            new WebViewMessage.SpanId({
                              traceId: data.span.traceId,
                              spanId: data.span.spanId
                            })
                          )
                      }
                    )
                  ) {
                    spanIds.push(
                      new WebViewMessage.SpanId({
                        traceId: _.span.traceId,
                        spanId: _.span.spanId
                      })
                    )
                  }

                  return yield* request(
                    new WebViewMessage.SpanListInfo({
                      traceId: message.traceId,
                      spanIds
                    })
                  )
                }
                case "SpanDataForListRequest": {
                  const { graph: info } = yield* currentCapture
                  const maybeInfo = HashMap.get(
                    info.nodeIndexBySpanAndTraceId,
                    DevtoolSpanCollector.SpanAndTraceId.make({
                      traceId: message.spanId.traceId,
                      spanId: message.spanId.spanId
                    })
                  ).pipe(
                    Option.flatMap((nodeId) =>
                      Graph.getNode(info.graph, nodeId).pipe(
                        Option.map(
                          (nodeInfo) =>
                            new WebViewMessage.SpanDataForListInfo({
                              spanId: message.spanId,
                              name: Option.fromNullable(
                                nodeInfo.span._tag === "Span"
                                  ? nodeInfo.span.name
                                  : undefined
                              ),
                              depth: DevtoolSpanCollector.countParentSpans(
                                nodeInfo.span
                              ),
                              hasChildren: !Iterable.isEmpty(
                                Graph.neighborsDirected(
                                  info.graph,
                                  nodeId,
                                  "outgoing"
                                )
                              ),
                              startTime: Option.fromNullable(
                                nodeInfo.span._tag === "Span"
                                  ? nodeInfo.span.status.startTime
                                  : undefined
                              ),
                              endTime: Option.fromNullable(
                                nodeInfo.span._tag === "Span" &&
                                  nodeInfo.span.status._tag === "Ended"
                                  ? nodeInfo.span.status.endTime
                                  : undefined
                              )
                            })
                        )
                      )
                    )
                  )
                  return yield* request(
                    Option.getOrElse(
                      maybeInfo,
                      () =>
                        new WebViewMessage.SpanDataForListInfo({
                          spanId: message.spanId,
                          depth: 0,
                          hasChildren: false,
                          name: Option.none(),
                          startTime: Option.none(),
                          endTime: Option.none()
                        })
                    )
                  )
                }
                case "SpanDataForDetailsRequest": {
                  const { graph: data } = yield* currentCapture
                  const info = HashMap.get(
                    data.nodeIndexBySpanAndTraceId,
                    DevtoolSpanCollector.SpanAndTraceId.make({
                      traceId: message.spanId.traceId,
                      spanId: message.spanId.spanId
                    })
                  ).pipe(
                    Option.flatMap((nodeId) =>
                      Graph.getNode(data.graph, nodeId).pipe(
                        Option.map((nodeInfo) => nodeInfo)
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
                case "MinimapDataRequest": {
                  const { graph: info, usedRange } = yield* currentCapture
                  const bars: Array<WebViewMessage.MinimapBar> = []
                  const spanOrder = Order.mapInput(
                    Order.bigint,
                    (nodeIndex: Graph.NodeIndex) => {
                      const nodeInfo = info.graph.nodes.get(nodeIndex)!
                      return nodeInfo.span._tag === "Span"
                        ? nodeInfo.span.status.startTime
                        : BigInt(0)
                    }
                  )

                  const rootIds = pipe(
                    Graph.externals(info.graph, { direction: "incoming" }),
                    Graph.indices,
                    Array.fromIterable,
                    Array.filter(
                      (index) =>
                        Option.isNone(message.traceId) ||
                        Equal.equals(
                          message.traceId,
                          Option.some(
                            info.graph.nodes.get(index)?.span.traceId
                          )
                        )
                    )
                  )

                  // Iterate through all spans in the graph
                  for (
                    const [_o, nodeInfo] of GraphUtils.dfsChooseContinue(
                      info.graph,
                      {
                        start: rootIds,
                        direction: "outgoing",
                        order: spanOrder,
                        chooseContinue: () => true // Include all spans
                      }
                    )
                  ) {
                    let color: string
                    let startTime: bigint
                    let endTime: bigint

                    if (nodeInfo.span._tag === "ExternalSpan") {
                      // External spans are purple
                      color = "hsl(270, 70%, 60%)"
                      // External spans don't have timing info, use 0
                      startTime = usedRange._tag === "Some" ? usedRange.value[0] : BigInt(0)
                      endTime = usedRange._tag === "Some" ? usedRange.value[1] : BigInt(0)
                    } else if (nodeInfo.span._tag === "Span") {
                      startTime = nodeInfo.span.status.startTime

                      if (nodeInfo.span.status._tag === "Ended") {
                        // Completed spans are blue
                        endTime = nodeInfo.span.status.endTime
                        color = "hsl(210, 70%, 60%)"
                      } else {
                        // Running spans are dark gray
                        endTime = usedRange._tag === "Some" ? usedRange.value[1] : BigInt(0)
                        color = "hsl(0, 0%, 40%)"
                      }

                      bars.push(
                        new WebViewMessage.MinimapBar({
                          startTime,
                          endTime,
                          color
                        })
                      )
                    }
                  }

                  return yield* request(
                    new WebViewMessage.MinimapDataInfo({
                      traceId: message.traceId,
                      bars
                    })
                  )
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
  })
)
