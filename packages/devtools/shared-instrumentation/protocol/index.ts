import * as Schema from "effect/Schema"

const InstrumentationId = Schema.String.annotations({ identifier: "InstrumentationId" })
const RequestId = Schema.String.annotations({ identifier: "RequestId" })
const ProtocolVersion = Schema.Literal(1).annotations({ identifier: "ProtocolVersion" })

const commonRequestFields = {
  protocolVersion: ProtocolVersion,
  requestId: RequestId
}

const commonResponseFields = {
  protocolVersion: Schema.Literal(1),
  instrumentationId: InstrumentationId
}

// a variable reference is identified by instrumentationId + requestId + index
export const VariableReferenceId = Schema.TaggedStruct("VariableReference", {
  instrumentationId: InstrumentationId,
  requestId: RequestId,
  index: Schema.String
}).annotations({ identifier: "VariableReferenceId" })

// span information
const SpanAttributesSchema = Schema.Array(
  Schema.Tuple(Schema.String, VariableReferenceId)
)

const SpanAndTraceId = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String
}).annotations({ identifier: "SpanAndTraceId" })

const SpanStatusSchema = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Started"), startTime: Schema.BigInt }).annotations({
    identifier: "SpanStatusStarted"
  }),
  Schema.Struct({ _tag: Schema.Literal("Ended"), startTime: Schema.BigInt, endTime: Schema.BigInt }).annotations({
    identifier: "SpanStatusEnded"
  })
).annotations({ identifier: "SpanStatus" })

const ExternalSpanSchema = Schema.Struct({
  _tag: Schema.Literal("ExternalSpan"),
  spanId: Schema.String,
  traceId: Schema.String,
  sampled: Schema.Boolean
}).annotations({ identifier: "ExternalSpan" })

const SpanSchema = Schema.Struct({
  _tag: Schema.Literal("Span"),
  spanId: Schema.String,
  traceId: Schema.String,
  name: Schema.String,
  sampled: Schema.Boolean,
  attributes: SpanAttributesSchema,
  status: SpanStatusSchema,
  parent: Schema.NullOr(SpanAndTraceId)
}).annotations({ identifier: "Span" })

export const AnySpanSchema = Schema.Union(SpanSchema, ExternalSpanSchema).annotations({ identifier: "AnySpan" })

export const TracerSpanNotification = Schema.TaggedStruct("TracerSpanNotification", {
  ...commonResponseFields,
  span: AnySpanSchema
}).annotations({ identifier: "TracerSpanNotification" })

// sent by the instrumentation to say hello to the client
export const PingNotification = Schema.TaggedStruct("PingNotification", {
  ...commonResponseFields
}).annotations({ identifier: "PingNotification" })

// requests information for a given variable reference
export const VariableReferenceInfoRequest = Schema.TaggedStruct("VariableReferenceInfoRequest", {
  ...commonRequestFields,
  variableReferenceId: VariableReferenceId
}).annotations({ identifier: "VariableReferenceInfoRequest" })

export const VariableReferenceInfo = Schema.TaggedStruct("VariableReferenceInfo", {
  ...commonResponseFields,
  variableReferenceId: VariableReferenceId,
  value: Schema.NullOr(Schema.Struct({
    name: Schema.NullOr(Schema.String),
    value: Schema.NullOr(Schema.String),
    children: Schema.Array(VariableReferenceId)
  }))
}).annotations({ identifier: "VariableReferenceInfo" })

// release from memory any held in references associated with the given request ids
export const ReleaseResourcesForRequest = Schema.TaggedStruct("ReleaseResourcesForRequest", {
  ...commonRequestFields,
  associatedRequestIds: Schema.Array(RequestId)
}).annotations({ identifier: "ReleaseResourcesForRequest" })

export const ResourcesForRequestReleased = Schema.TaggedStruct("ResourcesForRequestReleased", {
  ...commonResponseFields,
  associatedRequestIds: Schema.Array(RequestId)
}).annotations({ identifier: "ResourcesForRequestReleased" })

export const CaptureCurrentFibersRequest = Schema.TaggedStruct("CaptureCurrentFibersRequest", {
  ...commonRequestFields
}).annotations({ identifier: "CaptureCurrentFibersRequest" })

export const InMessage = Schema.Union(
  ReleaseResourcesForRequest,
  CaptureCurrentFibersRequest,
  VariableReferenceInfoRequest
).annotations({ identifier: "InMessage" })

export const FiberInfo = Schema.TaggedStruct("FiberInfo", {
  id: Schema.String,
  isCurrent: Schema.Boolean,
  currentSpan: Schema.NullOr(AnySpanSchema)
}).annotations({ identifier: "FiberInfo" })

export const CurrentFibersInfo = Schema.TaggedStruct("CurrentFibersInfo", {
  ...commonResponseFields,
  requestId: RequestId,
  fibers: Schema.Array(FiberInfo)
}).annotations({ identifier: "CurrentFibersInfo" })

export const OutMessage = Schema.Union(
  CurrentFibersInfo,
  VariableReferenceInfo,
  ResourcesForRequestReleased,
  PingNotification,
  TracerSpanNotification,
  Schema.Struct({ _: VariableReferenceId })
).annotations({ identifier: "OutMessage" })
