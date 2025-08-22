import type * as MetricState from "effect/MetricState"
import type * as Option from "effect/Option"

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
