import { ParentSpan, SpanEvent } from "@effect/experimental/DevTools/Domain"
import * as Schema from "effect/Schema"

export class Booted extends Schema.TaggedClass<Booted>()("Booted", {}) {}
export class ResetTracer extends Schema.TaggedClass<ResetTracer>()("ResetTracer", {}) {}
export class GoToLocation extends Schema.TaggedClass<GoToLocation>()("GoToLocation", {
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int
}) {}

export const HostMessage = Schema.Union(ResetTracer, ParentSpan, SpanEvent)
