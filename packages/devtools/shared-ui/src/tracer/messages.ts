import * as Domain from "@effect/experimental/DevTools/Domain"
import * as Schema from "effect/Schema"

export class Initialized extends Schema.TaggedClass<Initialized>("Initialized")(
  "Initialized",
  {}
) {}

export class SpanId extends Schema.TaggedClass<SpanId>("SpanId")("SpanId", {
  traceId: Schema.NonEmptyTrimmedString,
  spanId: Schema.NonEmptyTrimmedString
}) {
  get key(): string {
    return `${this.traceId}-${this.spanId}`
  }
}

export class RefreshRequest extends Schema.TaggedClass<RefreshRequest>("RefreshRequest")("RefreshRequest", {}) {}

export class TraceListRequest extends Schema.TaggedClass<TraceListRequest>(
  "TraceListRequest"
)("TraceListRequest", {}) {}

export class TraceListInfo extends Schema.TaggedClass<TraceListInfo>(
  "TraceListInfo"
)("TraceListInfo", {
  traceIds: Schema.Array(Schema.NonEmptyTrimmedString)
}) {}

export class SpanListRequest extends Schema.TaggedClass<SpanListRequest>(
  "SpanListRequest"
)("SpanListRequest", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString),
  expandedSpanIds: Schema.HashSet(SpanId),
  timeRange: Schema.Option(Schema.Tuple(Schema.BigInt, Schema.BigInt))
}) {}

export class SpanListInfo extends Schema.TaggedClass<SpanListInfo>(
  "SpanListInfo"
)("SpanListInfo", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString),
  spanIds: Schema.Array(SpanId)
}) {}

export class SpanDataForListRequest extends Schema.TaggedClass<SpanDataForListRequest>(
  "SpanDataForListRequest"
)("SpanDataForListRequest", {
  spanId: SpanId
}) {}

export class SpanDataForListInfo extends Schema.TaggedClass<SpanDataForListInfo>(
  "SpanDataForListInfo"
)("SpanDataForListInfo", {
  spanId: SpanId,
  name: Schema.Option(Schema.String),
  depth: Schema.Int,
  hasChildren: Schema.Boolean,
  startTime: Schema.Option(Schema.BigInt),
  endTime: Schema.Option(Schema.BigInt)
}) {}

export class SpanDataForDetailsRequest extends Schema.TaggedClass<SpanDataForDetailsRequest>(
  "SpanDataForDetailsRequest"
)("SpanDataForDetailsRequest", {
  spanId: SpanId
}) {}

export class SpanDataForDetailsInfo extends Schema.TaggedClass<SpanDataForDetailsInfo>(
  "SpanDataForDetailsInfo"
)("SpanDataForDetailsInfo", {
  spanId: SpanId,
  data: Domain.ParentSpan,
  events: Schema.Array(Domain.SpanEvent)
}) {}

export class UsedRangeRequest extends Schema.TaggedClass<UsedRangeRequest>(
  "UsedRangeRequest"
)("UsedRangeRequest", {}) {}

export class UsedRangeInfo extends Schema.TaggedClass<UsedRangeInfo>(
  "UsedRangeInfo"
)("UsedRangeInfo", {
  startTime: Schema.BigInt,
  endTime: Schema.BigInt
}) {}

export class MinimapBar extends Schema.Class<MinimapBar>("MinimapBar")({
  startTime: Schema.BigInt,
  endTime: Schema.BigInt,
  color: Schema.String
}) {}

export class MinimapDataRequest extends Schema.TaggedClass<MinimapDataRequest>(
  "MinimapDataRequest"
)("MinimapDataRequest", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString)
}) {}

export class MinimapDataInfo extends Schema.TaggedClass<MinimapDataInfo>(
  "MinimapDataInfo"
)("MinimapDataInfo", {
  traceId: Schema.Option(Schema.NonEmptyTrimmedString),
  bars: Schema.Array(MinimapBar)
}) {}

export const InMessage = Schema.Union(
  TraceListInfo,
  SpanListInfo,
  SpanDataForListInfo,
  UsedRangeInfo,
  SpanDataForDetailsInfo,
  MinimapDataInfo
)
export type InMessage = Schema.Schema.Type<typeof InMessage>

export const OutMessage = Schema.Union(
  Initialized,
  RefreshRequest,
  TraceListRequest,
  SpanListRequest,
  SpanDataForListRequest,
  UsedRangeRequest,
  SpanDataForDetailsRequest,
  MinimapDataRequest
)
export type OutMessage = Schema.Schema.Type<typeof OutMessage>
