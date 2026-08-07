import type * as Option from "effect/Option"
import { optionNone, optionSome } from "./shims-v3"

export const currentFiberKeyV4 = "~effect/Fiber/currentFiber"
export const contextTypeIdV4 = "~effect/Context"
export const effectEvaluateV4 = "~effect/Effect/evaluate"
export const exitTypeIdV4 = "~effect/Exit"
export const metricRegistryKeyV4 = "~effect/observability/Metric/MetricRegistryKey"
export const tracerKeyV4 = "effect/Tracer"

export function isExitFailureV4(value: unknown): value is {
  readonly _tag: "Failure"
  readonly cause: { readonly reasons: ReadonlyArray<unknown> }
} {
  return typeof value === "object" && value !== null && exitTypeIdV4 in value && "_tag" in value &&
    value._tag === "Failure" && "cause" in value
}

export const causeDieOptionV4 = (cause: { readonly reasons: ReadonlyArray<unknown> }): Option.Option<unknown> => {
  for (const reason of cause.reasons) {
    if (
      typeof reason === "object" && reason !== null && "_tag" in reason && reason._tag === "Die" &&
      "defect" in reason
    ) {
      return optionSome(reason.defect)
    }
  }
  return optionNone()
}
