import * as Schema from "effect/Schema"

export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")("Initialized", {}) {}

export class TraceListRequest
  extends Schema.TaggedClass<TraceListRequest>("TraceListRequest")("TraceListRequest", {})
{}

export class TraceListInfo extends Schema.TaggedClass<TraceListInfo>("TraceListInfo")("TraceListInfo", {
  traceIds: Schema.Array(Schema.NonEmptyTrimmedString)
}) {}

export class SpanListRequest extends Schema.TaggedClass<SpanListRequest>("SpanListRequest")("SpanListRequest", {
  traceId: Schema.NonEmptyTrimmedString,
  expandedSpanIds: Schema.Array(Schema.NonEmptyTrimmedString)
}) {}

export class SpanListInfo extends Schema.TaggedClass<SpanListInfo>("SpanListInfo")("SpanListInfo", {
  traceId: Schema.NonEmptyTrimmedString,
  spanIds: Schema.Array(Schema.NonEmptyTrimmedString)
}) {}

export const InMessage = Schema.Union(TraceListInfo, SpanListInfo)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(Initialized, TraceListRequest, SpanListRequest)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
