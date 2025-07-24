/* eslint-disable object-shorthand */
import type * as Domain from "@effect/experimental/DevTools/Domain"
import type { Fiber } from "effect/Fiber"
import type * as Schema from "effect/Schema"
import type * as Tracer from "effect/Tracer"
import {
  getOrUndefined,
  globalMetricRegistrySymbol,
  globalStores,
  isCounterState,
  isFrequencyState,
  isGaugeState,
  isHistogramState,
  isSummaryState
} from "./shims"

const _globalThis = globalThis as any

const instrumentationKey = "effect/devtools/instrumentation"

const instrumentationId = Math.random().toString(36).substring(2, 15)

function addSetInterceptor<O extends object, K extends keyof O>(
  obj: O,
  key: K,
  interceptor: (v: O[K]) => void
) {
  const previousProperty = Object.getOwnPropertyDescriptor(obj, key)
  if (previousProperty && previousProperty.set) {
    Object.defineProperty(obj, key, {
      "value": previousProperty.value,
      "writable": previousProperty.writable,
      "enumerable": previousProperty.enumerable,
      "configurable": previousProperty.configurable,
      "get": previousProperty.get,
      "set": function(this: O, value: O[K]) {
        interceptor(value)
        previousProperty.set?.bind(this)(value)
      }
    })
  } else {
    let _value: O[K]
    Object.defineProperty(obj, key, {
      "set": function(this: O, value: O[K]) {
        _value = value
        interceptor(value)
      },
      "get": function() {
        return _value
      }
    })
  }
}

function metricsSnapshot(): Schema.Schema.Encoded<typeof Domain.MetricsSnapshot> {
  const metrics: Array<Schema.Schema.Encoded<typeof Domain.Metric>> = []

  const stores = globalStores()
  for (let i = 0; i < stores.length; i++) {
    const store = stores[i]
    const metricRegistry = store.get(globalMetricRegistrySymbol)
    if (!metricRegistry) continue
    const snapshot = metricRegistry.snapshot()
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
            "value": typeof metricPair.metricState.value === "bigint"
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
  }

  return {
    _tag: "MetricsSnapshot",
    metrics
  }
}

function convertExternalSpan(span: Tracer.ExternalSpan): Schema.Schema.Encoded<typeof Domain.ExternalSpan> {
  return {
    _tag: "ExternalSpan",
    traceId: span.traceId,
    spanId: span.spanId,
    sampled: span.sampled
  }
}

function convertSpan(span: Tracer.Span): Schema.Schema.Encoded<typeof Domain.Span> {
  return {
    _tag: "Span",
    spanId: span.spanId,
    traceId: span.traceId,
    name: span.name,
    sampled: span.sampled,
    status: span.status._tag === "Started"
      ? { _tag: "Started", startTime: String(span.status.startTime) }
      : { _tag: "Ended", startTime: String(span.status.startTime), endTime: String(span.status.endTime) },
    parent: span.parent._tag === "None"
      ? span.parent
      : ({ _tag: "Some", value: convertAnySpan(span.parent.value) }),
    attributes: Array.from(span.attributes.entries())
  }
}

function convertAnySpan(span: Tracer.AnySpan): Schema.Schema.Encoded<typeof Domain.ParentSpan> {
  if (span._tag === "ExternalSpan") {
    return convertExternalSpan(span)
  }
  return convertSpan(span)
}

// first inject the logic to track current and newly created fibers
if (!(instrumentationKey in globalThis)) {
  // keeps track if the devtools client has connected at least once
  let hasDevtoolsConnected = false

  // create a global array to store the current fibers
  const fibers: Array<Fiber.Runtime<any, any>> = []

  // invoked each time a fiber is running
  function addTrackedFiber(fiber: Fiber.Runtime<any, any>) {
    if (fibers.indexOf(fiber) === -1) {
      if (hasDevtoolsConnected) addTracerInterceptorToFiber(fiber)
      fibers.push(fiber)
      fiber.addObserver(() => {
        const index = fibers.indexOf(fiber)
        if (index > -1) {
          fibers.splice(index, 1)
        }
      })
    }
  }

  // replace the current tracer in a fiber with a new tracer that sends events to the devtools
  const patchedTracers: Array<Tracer.Tracer> = []
  const addTracerInterceptorToFiber = (fiber: Fiber.Runtime<any, any>) => {
    const _fiber = fiber as any
    // avoid to double patch the same fiber
    if (_fiber["effect/instrumentation/patchedCurrentTracer"]) return
    _fiber["effect/instrumentation/patchedCurrentTracer"] = true

    const previousTracer = fiber.currentTracer
    addSetInterceptor(fiber, "currentTracer", (tracer) => {
      // avoid to double patch the same tracer
      if (!tracer) return
      if (patchedTracers.indexOf(tracer) !== -1) return
      patchedTracers.push(tracer)

      // patch the span method to send start and end events
      const _span = tracer.span.bind(tracer)
      tracer.span = (...args) => {
        const span = _span(...args)
        try {
          pushNotification(convertSpan(span))

          // patch the event method to send events
          const _event = span.event.bind(span)
          span.event = (name, startTime, attributes, ...args) => {
            const result = _event(name, startTime, attributes, ...args)
            pushNotification({
              _tag: "SpanEvent",
              spanId: span.spanId,
              traceId: span.traceId,
              name,
              startTime: String(startTime),
              attributes: attributes || {}
            })
            return result
          }

          // patch the end method to send end events
          const _end = span.end.bind(span)
          span.end = (...args) => {
            const result = _end(...args)
            pushNotification(convertSpan(span))
            return result
          }
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
          // silently fail
        }
        return span
      }
    })
    // sets the value back
    _fiber.currentTracer = previousTracer
  }

  // two kind of storage responses and notifications,
  // notifications are with a sliding window
  const responses: Array<Schema.Schema.Encoded<typeof Domain.Request>> = []
  const notifications: Array<Schema.Schema.Encoded<typeof Domain.Request>> = []
  const pushNotification = (notification: Schema.Schema.Encoded<typeof Domain.Request>) => {
    notifications.push(notification)
    if (notifications.length > 1000) {
      notifications.shift()
    }
  }

  function debugProtocolDevtoolsClient(
    requests: Array<Schema.Schema.Encoded<typeof Domain.Response>>
  ): string {
    // handle first connection, add tracer interceptor to all fibers known at the moment
    if (!hasDevtoolsConnected) {
      hasDevtoolsConnected = true
      fibers.forEach(addTracerInterceptorToFiber)
    }

    // handle the requests
    const processedRequestTypes: Array<string> = []
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i]
      switch (request._tag) {
        case "Pong":
          continue
        case "MetricsRequest": {
          if (processedRequestTypes.indexOf(request._tag) !== -1) continue
          processedRequestTypes.push(request._tag)
          responses.push(metricsSnapshot())
          continue
        }
      }
    }

    // send the responses back
    const responsesToSend = responses.splice(0)
    const notificationsToSend = notifications.splice(0)
    return JSON.stringify({ responses: responsesToSend.concat(notificationsToSend), instrumentationId })
  }

  // set the instrumentation
  _globalThis[instrumentationKey] = {
    fibers,
    debugProtocolDevtoolsClient
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
