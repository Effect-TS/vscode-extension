/* eslint-disable @effect/dprint */
import * as Encoder from "./Encoder.ts"

export const InstrumentationId = Encoder.string
export type InstrumentationId = Encoder.Type<typeof InstrumentationId>
export const RequestId = Encoder.string
export type RequestId = Encoder.Type<typeof RequestId>
export const FiberInfo = Encoder.struct({_tag: Encoder.literal("FiberInfo"), id: Encoder.string, isCurrent: Encoder.boolean})
export type FiberInfo = Encoder.Type<typeof FiberInfo>
export const CurrentFibersInfo = Encoder.struct({_tag: Encoder.literal("CurrentFibersInfo"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, requestId: RequestId, fibers: Encoder.array(FiberInfo)})
export type CurrentFibersInfo = Encoder.Type<typeof CurrentFibersInfo>
export const VariableReferenceId = Encoder.struct({_tag: Encoder.literal("VariableReference"), instrumentationId: InstrumentationId, requestId: RequestId, index: Encoder.string})
export type VariableReferenceId = Encoder.Type<typeof VariableReferenceId>
export const VariableReferenceInfo = Encoder.struct({_tag: Encoder.literal("VariableReferenceInfo"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, variableReferenceId: VariableReferenceId, value: Encoder.union(Encoder.struct({name: Encoder.union(Encoder.string, Encoder.literal(null)), value: Encoder.union(Encoder.string, Encoder.literal(null)), children: Encoder.array(VariableReferenceId)}), Encoder.literal(null))})
export type VariableReferenceInfo = Encoder.Type<typeof VariableReferenceInfo>
export const ResourcesForRequestReleased = Encoder.struct({_tag: Encoder.literal("ResourcesForRequestReleased"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId, associatedRequestIds: Encoder.array(RequestId)})
export type ResourcesForRequestReleased = Encoder.Type<typeof ResourcesForRequestReleased>
export const PingNotification = Encoder.struct({_tag: Encoder.literal("PingNotification"), protocolVersion: Encoder.literal(1), instrumentationId: InstrumentationId})
export type PingNotification = Encoder.Type<typeof PingNotification>
export const OutMessage = Encoder.union(CurrentFibersInfo, VariableReferenceInfo, ResourcesForRequestReleased, PingNotification, Encoder.struct({_: VariableReferenceId}))
export type OutMessage = Encoder.Type<typeof OutMessage>
