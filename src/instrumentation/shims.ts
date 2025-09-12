import type * as Cause from "effect/Cause"
import type * as Effect from "effect/Effect"
import type * as Exit from "effect/Exit"
import type * as MetricState from "effect/MetricState"
import type * as Option from "effect/Option"
import type * as RuntimeFlags from "effect/RuntimeFlags"

/** @internal */
const MetricStateSymbolKey = "effect/MetricState"

/** @internal */
export const MetricStateTypeId: MetricState.MetricStateTypeId = Symbol.for(
  MetricStateSymbolKey
) as MetricState.MetricStateTypeId

/** @internal */
const CounterStateSymbolKey = "effect/MetricState/Counter"

/** @internal */
export const CounterStateTypeId: MetricState.CounterStateTypeId = Symbol.for(
  CounterStateSymbolKey
) as MetricState.CounterStateTypeId

/** @internal */
const FrequencyStateSymbolKey = "effect/MetricState/Frequency"

/** @internal */
export const FrequencyStateTypeId: MetricState.FrequencyStateTypeId = Symbol.for(
  FrequencyStateSymbolKey
) as MetricState.FrequencyStateTypeId

/** @internal */
const GaugeStateSymbolKey = "effect/MetricState/Gauge"

/** @internal */
export const GaugeStateTypeId: MetricState.GaugeStateTypeId = Symbol.for(
  GaugeStateSymbolKey
) as MetricState.GaugeStateTypeId

/** @internal */
const HistogramStateSymbolKey = "effect/MetricState/Histogram"

/** @internal */
export const HistogramStateTypeId: MetricState.HistogramStateTypeId = Symbol.for(
  HistogramStateSymbolKey
) as MetricState.HistogramStateTypeId

/** @internal */
const SummaryStateSymbolKey = "effect/MetricState/Summary"

/** @internal */
export const SummaryStateTypeId: MetricState.SummaryStateTypeId = Symbol.for(
  SummaryStateSymbolKey
) as MetricState.SummaryStateTypeId

/**
 * @since 2.0.0
 * @category refinements
 */
export const isMetricState = (u: unknown): u is MetricState.MetricState.Untyped =>
  typeof u === "object" && u !== null && MetricStateTypeId in u

/**
 * @since 2.0.0
 * @category refinements
 */
export const isCounterState = (u: unknown): u is MetricState.MetricState.Counter<number | bigint> =>
  typeof u === "object" && u !== null && CounterStateTypeId in u

/**
 * @since 2.0.0
 * @category refinements
 */
export const isFrequencyState = (u: unknown): u is MetricState.MetricState.Frequency =>
  typeof u === "object" && u !== null && FrequencyStateTypeId in u

/**
 * @since 2.0.0
 * @category refinements
 */
export const isGaugeState = (u: unknown): u is MetricState.MetricState.Gauge<number | bigint> =>
  typeof u === "object" && u !== null && GaugeStateTypeId in u

/**
 * @since 2.0.0
 * @category refinements
 */
export const isHistogramState = (u: unknown): u is MetricState.MetricState.Histogram =>
  typeof u === "object" && u !== null && HistogramStateTypeId in u

/**
 * @since 2.0.0
 * @category refinements
 */
export const isSummaryState = (u: unknown): u is MetricState.MetricState.Summary =>
  typeof u === "object" && u !== null && SummaryStateTypeId in u

/** @internal */
export const globalMetricRegistrySymbol = Symbol.for("effect/Metric/globalMetricRegistry")

export const EffectTypeId: Effect.EffectTypeId = Symbol.for("effect/Effect") as Effect.EffectTypeId

export function globalStores(): Array<Map<any, any>> {
  return Object.keys(globalThis).filter(function(key) {
    return key.indexOf("effect/GlobalValue/globalStoreId") > -1 || key === "effect/GlobalValue"
  }).map(function(key) {
    return (globalThis as any)[key]
  })
}

export function getOrUndefined<T>(option: Option.Option<T>): T | undefined {
  return option._tag === "Some" ? option.value : undefined
}

/* RuntimeFlags */
const Interruption: RuntimeFlags.RuntimeFlag = 1 << 0 as RuntimeFlags.RuntimeFlag
const WindDown: RuntimeFlags.RuntimeFlag = 1 << 4 as RuntimeFlags.RuntimeFlag

const isEnabled = (self: RuntimeFlags.RuntimeFlags, flag: RuntimeFlags.RuntimeFlag) => (self & flag) !== 0
export const interruptible = (self: RuntimeFlags.RuntimeFlags): boolean =>
  isEnabled(self, Interruption) && !isEnabled(self, WindDown)

export const optionSome = <T>(value: T): Option.Option<T> => ({ _tag: "Some", value }) as any
export const optionNone = <T>(): Option.Option<T> => ({ _tag: "None" }) as any

export const find = <E, Z>(self: Cause.Cause<E>, pf: (cause: Cause.Cause<E>) => Option.Option<Z>): Option.Option<Z> => {
  const stack: Array<Cause.Cause<E>> = [self]
  while (stack.length > 0) {
    const item = stack.pop()!
    if (!item) continue
    if (!("_tag" in item)) continue
    const option = pf(item)
    switch (option._tag) {
      case "None": {
        switch (item._tag) {
          case "Parallel":
          case "Sequential": {
            stack.push(item.right)
            stack.push(item.left)
            break
          }
        }
        break
      }
      case "Some": {
        return option
      }
    }
  }
  return optionNone()
}

export const causeDieOption = <E>(self: Cause.Cause<E>): Option.Option<unknown> =>
  find(
    self,
    (cause) =>
      typeof cause === "object" && cause !== null && "_tag" in cause && cause._tag === "Die" && "defect" in cause ?
        optionSome(cause.defect) :
        optionNone()
  )

export function isExitFailure(value: unknown): value is Exit.Failure<unknown, unknown> {
  return typeof value === "object" && value !== null && EffectTypeId in value && "_tag" in value &&
    value._tag === "Failure" && "cause" in value
}

const originalSymbol = Symbol.for("effect/OriginalAnnotation")

/* @internal */
export const originalInstance = <E>(obj: E): E => {
  if (typeof obj === "object" && obj !== null && originalSymbol in obj) {
    // @ts-expect-error
    return obj[originalSymbol]
  }
  return obj
}
