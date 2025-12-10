import * as Schema from "effect/Schema"

export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")("Initialized", {}) {}

export class SpanId extends Schema.TaggedClass<SpanId>("SpanId")("SpanId", {
  traceId: Schema.NonEmptyTrimmedString,
  spanId: Schema.NonEmptyTrimmedString
}) {
  get key(): string {
    return `${this.traceId}-${this.spanId}`
  }
}

export class TraceListRequest
  extends Schema.TaggedClass<TraceListRequest>("TraceListRequest")("TraceListRequest", {})
{}

export class TraceListInfo extends Schema.TaggedClass<TraceListInfo>("TraceListInfo")("TraceListInfo", {
  traceIds: Schema.Array(Schema.NonEmptyTrimmedString)
}) {}

export class SpanListRequest extends Schema.TaggedClass<SpanListRequest>("SpanListRequest")("SpanListRequest", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString),
  expandedSpanIds: Schema.Array(SpanId)
}) {}

export class SpanListInfo extends Schema.TaggedClass<SpanListInfo>("SpanListInfo")("SpanListInfo", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString),
  spanIds: Schema.Array(SpanId)
}) {}

export class SpanDataForListRequest
  extends Schema.TaggedClass<SpanDataForListRequest>("SpanDataForListRequest")("SpanDataForListRequest", {
    spanId: SpanId
  })
{}

export class SpanDataForListInfo
  extends Schema.TaggedClass<SpanDataForListInfo>("SpanDataForListInfo")("SpanDataForListInfo", {
    spanId: SpanId,
    name: Schema.Option(Schema.String),
    depth: Schema.Int,
    startTime: Schema.Option(Schema.BigInt),
    endTime: Schema.Option(Schema.BigInt)
  })
{}

export class UsedRangeRequest
  extends Schema.TaggedClass<UsedRangeRequest>("UsedRangeRequest")("UsedRangeRequest", {})
{}

export class UsedRangeInfo extends Schema.TaggedClass<UsedRangeInfo>("UsedRangeInfo")("UsedRangeInfo", {
  startTime: (Schema.BigInt),
  endTime: (Schema.BigInt)
}) {}

export const InMessage = Schema.Union(TraceListInfo, SpanListInfo, SpanDataForListInfo, UsedRangeInfo)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(
  Initialized,
  TraceListRequest,
  SpanListRequest,
  SpanDataForListRequest,
  UsedRangeRequest
)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
