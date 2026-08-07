import type * as Domain from "@effect/experimental/DevTools/Domain"
import type * as MetricPair from "effect/MetricPair"
import type * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import type * as Tracer from "effect/Tracer"
import {
  getOrUndefined,
  isCounterState,
  isFrequencyState,
  isGaugeState,
  isHistogramState,
  isSummaryState
} from "./shims-v3"

export function encodeOption<T, E>(
  option: Option.Option<T>,
  value: (x: T) => E
): { _tag: "Some"; value: E } | { _tag: "None" } {
  if (option._tag === "Some") {
    return {
      "_tag": "Some",
      "value": value(option.value)
    }
  }
  return { _tag: "None" }
}

export interface StackLocation {
  path: string
  line: number
  column: number
}

export function makeStackLocation(
  stackPath: string,
  stackLine: number,
  stackColumn: number
): StackLocation {
  return {
    "path": stackPath,
    "line": stackLine,
    "column": stackColumn
  }
}

export const encodeStackLocation = (x: StackLocation) => x

export function encodeMetricPairV3(
  metricPair: MetricPair.MetricPair.Untyped
): Schema.Schema.Encoded<typeof Domain.Metric> | undefined {
  if (isCounterState(metricPair.metricState)) {
    return {
      "_tag": "Counter",
      "name": metricPair.metricKey.name,
      "description": getOrUndefined(metricPair.metricKey.description),
      "tags": metricPair.metricKey.tags,
      "state": {
        "count": typeof metricPair.metricState.count === "bigint"
          ? metricPair.metricState.count.toString()
          : metricPair.metricState.count
      }
    }
  } else if (isGaugeState(metricPair.metricState)) {
    return {
      "_tag": "Gauge",
      "name": metricPair.metricKey.name,
      "description": getOrUndefined(metricPair.metricKey.description),
      "tags": metricPair.metricKey.tags,
      "state": {
        "value": typeof metricPair.metricState.value === "bigint"
          ? metricPair.metricState.value.toString()
          : metricPair.metricState.value
      }
    }
  } else if (isHistogramState(metricPair.metricState)) {
    return {
      "_tag": "Histogram",
      "name": metricPair.metricKey.name,
      "description": getOrUndefined(metricPair.metricKey.description),
      "tags": metricPair.metricKey.tags,
      "state": metricPair.metricState
    }
  } else if (isSummaryState(metricPair.metricState)) {
    return {
      "_tag": "Summary",
      "name": metricPair.metricKey.name,
      "description": getOrUndefined(metricPair.metricKey.description),
      "tags": metricPair.metricKey.tags,
      "state": metricPair.metricState
    }
  } else if (isFrequencyState(metricPair.metricState)) {
    return {
      "_tag": "Frequency",
      "name": metricPair.metricKey.name,
      "description": getOrUndefined(metricPair.metricKey.description),
      "tags": metricPair.metricKey.tags,
      "state": {
        "occurrences": Object.fromEntries(metricPair.metricState.occurrences.entries())
      }
    }
  }
}

export interface MetricSnapshotV4 {
  readonly id: string
  readonly type: "Counter" | "Frequency" | "Gauge" | "Histogram" | "Summary"
  readonly description: string | undefined
  readonly attributes: Readonly<Record<string, string>> | undefined
  readonly state: any
}

export function encodeMetricSnapshotV4(
  snapshot: MetricSnapshotV4
): Schema.Schema.Encoded<typeof Domain.Metric> | undefined {
  const base = {
    "_tag": snapshot.type,
    "name": snapshot.id,
    "description": snapshot.description,
    "tags": Object.entries(snapshot.attributes ?? {}).map(([key, value]) => ({ key, value }))
  }
  switch (snapshot.type) {
    case "Counter":
      return {
        ...base,
        "_tag": "Counter",
        "state": {
          "count": typeof snapshot.state.count === "bigint" ? snapshot.state.count.toString() : snapshot.state.count
        }
      }
    case "Frequency":
      return {
        ...base,
        "_tag": "Frequency",
        "state": {
          "occurrences": Object.fromEntries(snapshot.state.occurrences.entries())
        }
      }
    case "Gauge":
      return {
        ...base,
        "_tag": "Gauge",
        "state": {
          "value": typeof snapshot.state.value === "bigint" ? snapshot.state.value.toString() : snapshot.state.value
        }
      }
    case "Histogram":
      return { ...base, "_tag": "Histogram", "state": snapshot.state }
    case "Summary":
      return {
        ...base,
        "_tag": "Summary",
        "state": {
          ...snapshot.state,
          "error": 0,
          "quantiles": snapshot.state.quantiles.map(([quantile, value]: [number, number | undefined]) => [
            quantile,
            value === undefined ? { _tag: "None" } : { _tag: "Some", value }
          ])
        }
      }
  }
}

export function encodeExternalSpan(span: Tracer.ExternalSpan): Schema.Schema.Encoded<typeof Domain.ExternalSpan> {
  return {
    "_tag": span._tag,
    "traceId": span.traceId,
    "spanId": span.spanId,
    "sampled": span.sampled
  }
}

export function encodeSpan(span: Tracer.Span): Schema.Schema.Encoded<typeof Domain.Span> {
  return {
    "_tag": span._tag,
    "spanId": span.spanId,
    "traceId": span.traceId,
    "name": span.name,
    "sampled": span.sampled,
    "status": span.status._tag === "Started"
      ? { _tag: "Started", "startTime": String(span.status.startTime) }
      : { _tag: "Ended", "startTime": String(span.status.startTime), "endTime": String(span.status.endTime) },
    "parent": encodeOption(span.parent, encodeParentSpan),
    "attributes": Array.from(span.attributes.entries())
  }
}

export function encodeParentSpan(span: Tracer.AnySpan): Schema.Schema.Encoded<typeof Domain.ParentSpan> {
  if (span._tag === "ExternalSpan") {
    return encodeExternalSpan(span)
  }
  return encodeSpan(span)
}
