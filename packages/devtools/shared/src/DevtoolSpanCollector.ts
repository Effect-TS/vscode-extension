import type * as Domain from "@effect/experimental/DevTools/Domain"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Graph from "effect/Graph"
import * as Option from "effect/Option"

export interface GraphNodeInfo {
  readonly span: Domain.ParentSpan
  readonly events: Array<Domain.SpanEvent>
}

export type SpanGraph = Graph.MutableGraph<GraphNodeInfo, void>
export type SpanGraphInfo = {
  readonly graph: SpanGraph
  readonly nodeIdBySpanId: Map<string, number>
}

export class ClientsSpanGraphCollector extends Context.Tag("@effect/devtools-shared/DevtoolSpanCollector")<
  ClientsSpanGraphCollector,
  {
    readonly graphByTraceId: Effect.Effect<Map<string, SpanGraphInfo>>
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
