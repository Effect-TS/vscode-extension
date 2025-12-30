/* eslint-disable @effect/dprint */
import * as Decoder from "./Decoder.ts"

export const ProtocolVersion = Decoder.literal(1)
export type ProtocolVersion = Decoder.Type<typeof ProtocolVersion>
export const RequestId = Decoder.string
export type RequestId = Decoder.Type<typeof RequestId>
export const ReleaseResourcesForRequest = Decoder.struct({_tag: Decoder.literal("ReleaseResourcesForRequest"), protocolVersion: ProtocolVersion, requestId: RequestId, associatedRequestIds: Decoder.array(RequestId)})
export type ReleaseResourcesForRequest = Decoder.Type<typeof ReleaseResourcesForRequest>
export const CaptureCurrentFibersRequest = Decoder.struct({_tag: Decoder.literal("CaptureCurrentFibersRequest"), protocolVersion: ProtocolVersion, requestId: RequestId})
export type CaptureCurrentFibersRequest = Decoder.Type<typeof CaptureCurrentFibersRequest>
export const InstrumentationId = Decoder.string
export type InstrumentationId = Decoder.Type<typeof InstrumentationId>
export const VariableReferenceId = Decoder.struct({_tag: Decoder.literal("VariableReference"), instrumentationId: InstrumentationId, requestId: RequestId, index: Decoder.string})
export type VariableReferenceId = Decoder.Type<typeof VariableReferenceId>
export const VariableReferenceInfoRequest = Decoder.struct({_tag: Decoder.literal("VariableReferenceInfoRequest"), protocolVersion: ProtocolVersion, requestId: RequestId, variableReferenceId: VariableReferenceId})
export type VariableReferenceInfoRequest = Decoder.Type<typeof VariableReferenceInfoRequest>
export const InMessage = Decoder.union(ReleaseResourcesForRequest, CaptureCurrentFibersRequest, VariableReferenceInfoRequest)
export type InMessage = Decoder.Type<typeof InMessage>
