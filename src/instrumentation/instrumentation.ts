import type * as Domain from "@effect/experimental/DevTools/Domain"
import type { Fiber } from "effect/Fiber"
import type * as Schema from "effect/Schema"
import {
  getOrUndefined,
  isCounterState,
  isFrequencyState,
  isGaugeState,
  isHistogramState,
  isSummaryState,
  unsafeMetricSnapshot
} from "./shims"

const _globalThis = globalThis as any

const instrumentationKey = "effect/devtools/instrumentation"

const instrumentationId = Math.random().toString(36).substring(2, 15)

function addSetInterceptor<O extends object, K extends keyof O>(
  obj: O,
  key: K,
  interceptor: (value: O[K]) => void
) {
  const previousProperty = Object.getOwnPropertyDescriptor(obj, key)
  if (previousProperty && previousProperty.set) {
    Object.defineProperty(obj, key, {
      ...previousProperty,
      set(this: O, value: O[K]) {
        interceptor(value)
        previousProperty.set?.bind(this)(value)
      }
    })
  } else {
    let _value: O[K]
    Object.defineProperty(obj, key, {
      set(this: O, value: O[K]) {
        _value = value
        interceptor(value)
      },
      get() {
        return _value
      }
    })
  }
}

function metricsSnapshot(): Schema.Schema.Encoded<typeof Domain.MetricsSnapshot> {
  const snapshot = unsafeMetricSnapshot()
  const metrics: Array<Schema.Schema.Encoded<typeof Domain.Metric>> = []

  for (let i = 0, len = snapshot.length; i < len; i++) {
    const metricPair = snapshot[i]
    if (isCounterState(metricPair.metricState)) {
      metrics.push({
        _tag: "Counter",
        name: metricPair.metricKey.name,
        description: getOrUndefined(metricPair.metricKey.description),
        tags: metricPair.metricKey.tags,
        state: {
          count: typeof metricPair.metricState.count === "bigint"
            ? metricPair.metricState.count.toString()
            : metricPair.metricState.count
        }
      })
    } else if (isGaugeState(metricPair.metricState)) {
      metrics.push({
        _tag: "Gauge",
        name: metricPair.metricKey.name,
        description: getOrUndefined(metricPair.metricKey.description),
        tags: metricPair.metricKey.tags,
        state: {
          value: typeof metricPair.metricState.value === "bigint"
            ? metricPair.metricState.value.toString()
            : metricPair.metricState.value
        }
      })
    } else if (isHistogramState(metricPair.metricState)) {
      metrics.push({
        _tag: "Histogram",
        name: metricPair.metricKey.name,
        description: getOrUndefined(metricPair.metricKey.description),
        tags: metricPair.metricKey.tags,
        state: metricPair.metricState
      })
    } else if (isSummaryState(metricPair.metricState)) {
      metrics.push({
        _tag: "Summary",
        name: metricPair.metricKey.name,
        description: getOrUndefined(metricPair.metricKey.description),
        tags: metricPair.metricKey.tags,
        state: metricPair.metricState
      })
    } else if (isFrequencyState(metricPair.metricState)) {
      metrics.push({
        _tag: "Frequency",
        name: metricPair.metricKey.name,
        description: getOrUndefined(metricPair.metricKey.description),
        tags: metricPair.metricKey.tags,
        state: {
          occurrences: Object.fromEntries(metricPair.metricState.occurrences.entries())
        }
      })
    }
  }

  return {
    _tag: "MetricsSnapshot",
    metrics
  }
}

// first inject the logic to track current and newly created fibers
if (!(instrumentationKey in globalThis)) {
  // create a global array to store the current fibers
  const fibers: Array<Fiber.Runtime<any, any>> = []

  function handleClientRequest(
    request: Schema.Schema.Encoded<typeof Domain.Response>
  ): Array<Schema.Schema.Encoded<typeof Domain.Request>> {
    switch (request._tag) {
      case "Pong":
        return []
      case "MetricsRequest": {
        return [metricsSnapshot()]
      }
    }
    return []
  }

  function debugProtocolClient(
    requests: Array<Schema.Schema.Encoded<typeof Domain.Response>>
  ): { responses: Array<string>; instrumentationId: string } {
    const responses = requests.map(handleClientRequest).filter((_) => _ !== undefined).reduce(
      (acc, curr) => acc.concat(curr),
      []
    )
      .map((_) => JSON.stringify(_))

    return { responses, instrumentationId }
  }

  // invoked each time a fiber is running
  function addTrackedFiber(fiber: Fiber.Runtime<any, any>) {
    if (fibers.indexOf(fiber) === -1) {
      fibers.push(fiber)
      fiber.addObserver(() => {
        const index = fibers.indexOf(fiber)
        if (index > -1) {
          fibers.splice(index, 1)
        }
      })
    }
  }

  // set the instrumentation
  _globalThis[instrumentationKey] = {
    fibers,
    debugProtocolClient
  }

  // replace the effect/FiberCurrent with a getter/setter so we can detect fibers
  // starting for the first time
  const _previousFiber = _globalThis["effect/FiberCurrent"]
  addSetInterceptor(_globalThis, "effect/FiberCurrent", (_value: Fiber.Runtime<any, any> | undefined) => {
    if (_value) addTrackedFiber(_value)
  })
  // trigger the setter by re-setting its value
  _globalThis["effect/FiberCurrent"] = _previousFiber
}
