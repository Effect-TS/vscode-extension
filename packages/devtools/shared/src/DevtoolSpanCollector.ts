import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Graph from "effect/Graph"
import type * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export class SpanAndTraceId extends Schema.Class<SpanAndTraceId>("SpanAndTraceId")({
  traceId: Schema.String,
  spanId: Schema.String
}) {}

export interface GraphNodeInfo {
  readonly span: Domain.ParentSpan
  readonly events: Array<Domain.SpanEvent>
}

export type SpanGraph = Graph.Graph<GraphNodeInfo, void>
export type SpanGraphInfo = {
  readonly graph: SpanGraph
  readonly nodeIndexBySpanAndTraceId: HashMap.HashMap<SpanAndTraceId, Graph.NodeIndex>
}

export class ClientsSpanGraphCollector extends Context.Tag("@effect/devtools-shared/DevtoolSpanCollector")<
  ClientsSpanGraphCollector,
  {
    readonly graphByTraceId: Effect.Effect<SpanGraphInfo>
    readonly traceIds: Effect.Effect<Array<string>>
    readonly usedRange: Effect.Effect<Option.Option<[bigint, bigint]>>
  }
>() {}

export function countParentSpans(span: Domain.ParentSpan): number {
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
