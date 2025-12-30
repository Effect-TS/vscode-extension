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

// sent by the instrumentation to say hello to the client
export const PingNotification = Schema.TaggedStruct("PingNotification", {
  ...commonResponseFields
}).annotations({ identifier: "PingNotification" })

// a variable reference is identified by instrumentationId + requestId + index
export const VariableReferenceId = Schema.TaggedStruct("VariableReference", {
  instrumentationId: InstrumentationId,
  requestId: RequestId,
  index: Schema.String
}).annotations({ identifier: "VariableReferenceId" })

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
  isCurrent: Schema.Boolean
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
  Schema.Struct({ _: VariableReferenceId })
).annotations({ identifier: "OutMessage" })
