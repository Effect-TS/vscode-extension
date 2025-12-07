import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Effect from "effect/Effect"
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
              case "TraceListRequest": {
                return yield* request(new WebViewMessage.TraceListInfo({ traceIds: Array.from(graphByTraceId.keys()) }))
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
