/* eslint-disable @effect/dprint */
import * as Encoder from "./Encoder.ts"

export const InstrumentationId = Encoder.string
export type InstrumentationId = Encoder.Type<typeof InstrumentationId>
export const RequestId = Encoder.string
export type RequestId = Encoder.Type<typeof RequestId>
export const VariableReferenceId = Encoder.struct({_tag: Encoder.literal("VariableReference"), instrumentationId: InstrumentationId, requestId: RequestId, index: Encoder.string})
export type VariableReferenceId = Encoder.Type<typeof VariableReferenceId>
export const SpanStatusStarted = Encoder.struct({_tag: Encoder.literal("Started"), startTime: Encoder.bigint})
export type SpanStatusStarted = Encoder.Type<typeof SpanStatusStarted>
export const SpanStatusEnded = Encoder.struct({_tag: Encoder.literal("Ended"), startTime: Encoder.bigint, endTime: Encoder.bigint})
export type SpanStatusEnded = Encoder.Type<typeof SpanStatusEnded>
export const SpanStatus = Encoder.union(SpanStatusStarted, SpanStatusEnded)
export type SpanStatus = Encoder.Type<typeof SpanStatus>
export const SpanAndTraceId = Encoder.struct({traceId: Encoder.string, spanId: Encoder.string})
export type SpanAndTraceId = Encoder.Type<typeof SpanAndTraceId>
export const Span = Encoder.struct({_tag: Encoder.literal("Span"), spanId: Encoder.string, traceId: Encoder.string, name: Encoder.string, sampled: Encoder.boolean, attributes: Encoder.array(Encoder.tuple(Encoder.string, VariableReferenceId)), status: SpanStatus, parent: Encoder.union(SpanAndTraceId, Encoder.literal(null))})
export type Span = Encoder.Type<typeof Span>
export const ExternalSpan = Encoder.struct({_tag: Encoder.literal("ExternalSpan"), spanId: Encoder.string, traceId: Encoder.string, sampled: Encoder.boolean})
export type ExternalSpan = Encoder.Type<typeof ExternalSpan>
export const AnySpan = Encoder.union(Span, ExternalSpan)
export type AnySpan = Encoder.Type<typeof AnySpan>
export const FiberInfo = Encoder.struct({_tag: Encoder.literal("FiberInfo"), id: Encoder.string, isCurrent: Encoder.boolean, currentSpan: Encoder.union(AnySpan, Encoder.literal(null))})
export type FiberInfo = Encoder.Type<typeof FiberInfo>
export const CurrentFibersInfo = Encoder.struct({_tag: Encoder.literal("CurrentFibersInfo"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, requestId: RequestId, fibers: Encoder.array(FiberInfo)})
export type CurrentFibersInfo = Encoder.Type<typeof CurrentFibersInfo>
export const VariableReferenceInfo = Encoder.struct({_tag: Encoder.literal("VariableReferenceInfo"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, variableReferenceId: VariableReferenceId, value: Encoder.union(Encoder.struct({name: Encoder.union(Encoder.string, Encoder.literal(null)), value: Encoder.union(Encoder.string, Encoder.literal(null)), children: Encoder.array(VariableReferenceId)}), Encoder.literal(null))})
export type VariableReferenceInfo = Encoder.Type<typeof VariableReferenceInfo>
export const ResourcesForRequestReleased = Encoder.struct({_tag: Encoder.literal("ResourcesForRequestReleased"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, associatedRequestIds: Encoder.array(RequestId)})
export type ResourcesForRequestReleased = Encoder.Type<typeof ResourcesForRequestReleased>
export const PingNotification = Encoder.struct({_tag: Encoder.literal("PingNotification"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId})
export type PingNotification = Encoder.Type<typeof PingNotification>
export const TracerSpanNotification = Encoder.struct({_tag: Encoder.literal("TracerSpanNotification"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, span: AnySpan})
export type TracerSpanNotification = Encoder.Type<typeof TracerSpanNotification>
export const OutMessage = Encoder.union(CurrentFibersInfo, VariableReferenceInfo, ResourcesForRequestReleased, PingNotification, TracerSpanNotification, Encoder.struct({_: VariableReferenceId}))
export type OutMessage = Encoder.Type<typeof OutMessage>
