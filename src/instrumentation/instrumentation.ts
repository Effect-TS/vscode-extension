/* eslint-disable object-shorthand */
import type * as Domain from "@effect/experimental/DevTools/Domain"
import type { Fiber } from "effect/Fiber"
import type * as MetricPair from "effect/MetricPair"
import type * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import type * as Tracer from "effect/Tracer"
import type { StackLocation } from "./encoders"
import { encodeMetricPair, encodeOption, encodeSpan, encodeStackLocation, makeStackLocation } from "./encoders"
import {
  causeDieOption,
  globalMetricRegistrySymbol,
  globalStores,
  interruptible,
  isExitFailure,
  optionNone,
  optionSome,
  originalInstance
} from "./shims"
import { addSetInterceptor } from "./utils"

interface DebuggerState {
  pauseOnDefects: boolean
  lastDefect: Option.Option<{ span: Tracer.AnySpan | undefined; value: unknown }>
  locationToReveal: Option.Option<StackLocation>
  valuesToReveal: Array<{
    label: string
    value: unknown
  }>
}

const instrumentationKey = "effect/devtools/instrumentation"
const currentInstrumentationTracerKey = "effect/instrumentation/currentTracer"

// first inject the logic to track current and newly created fibers
if (!(instrumentationKey in globalThis)) {
  const _globalThis = globalThis as any
  // local state of the instrumentation
  const fibers: Array<Fiber.Runtime<any, any>> = []
  const instrumentationId = Math.random().toString(36).substring(2, 15)
  let debuggerState: DebuggerState = {
    pauseOnDefects: false,
    lastDefect: optionNone(),
    locationToReveal: optionNone(),
    valuesToReveal: []
  }

  // set the instrumentation
  _globalThis[instrumentationKey] = {
    "fibers": fibers,
    "debugProtocolDevtoolsClient": debugProtocolDevtoolsClient,
    "getFiberCurrentSpanStack": getFiberCurrentSpanStack,
    "getFiberCurrentContext": getFiberCurrentContext,
    "getAliveFibers": getAliveFibers,
    "getAutoPauseConfig": getAutoPauseConfig,
    "togglePauseOnDefects": togglePauseOnDefects,
    "getAndUnsetPauseStateToReveal": getAndUnsetPauseStateToReveal
  }

  function metricsSnapshot(): Schema.Schema.Encoded<typeof Domain.MetricsSnapshot> {
    const metrics: Array<Schema.Schema.Encoded<typeof Domain.Metric>> = []

    const stores = globalStores()
    for (let i = 0; i < stores.length; i++) {
      const store = stores[i]
      const metricRegistry = store.get(globalMetricRegistrySymbol)
      if (!metricRegistry) continue
      const snapshot: Array<MetricPair.MetricPair.Untyped> = metricRegistry.snapshot()
      for (let i = 0, len = snapshot.length; i < len; i++) {
        const encoded = encodeMetricPair(snapshot[i])
        if (encoded) {
          metrics.push(encoded)
        }
      }
    }

    return {
      "_tag": "MetricsSnapshot",
      "metrics": metrics
    }
  }

  function getSpanStack(span: Tracer.AnySpan): Array<StackLocation> {
    const stackString = globalStores().reduce((acc, store) => {
      if (acc || !store) return acc
      const spanToTrace = store.get("effect/Tracer/spanToTrace")
      const stackFn = spanToTrace ? spanToTrace.get(span) : acc
      return stackFn ? stackFn() : acc
    }, undefined) || ""
    const stack = stackString.split("\n").filter((_) => String(_).length > 0)
    const out: Array<StackLocation> = []
    for (let i = 0; i < stack.length; i++) {
      const line = stack[i]
      const match = line.match(/^at (.*) \((.*):(\d+):(\d+)\)$/)
      if (match) {
        out.push(makeStackLocation(match[2], parseInt(match[3], 10) - 1, parseInt(match[4], 10) - 1))
      } else {
        const matchOnlyAt = line.match(/^at (.*):(\d+):(\d+)$/)
        if (matchOnlyAt) {
          out.push(
            makeStackLocation(matchOnlyAt[1], parseInt(matchOnlyAt[2], 10) - 1, parseInt(matchOnlyAt[3], 10) - 1)
          )
        }
      }
    }
    return out
  }

  function getFiberCurrentSpanStack(fiber: Fiber.Runtime<any, any>, maxDepth: number) {
    const spans: Array<any> = []
    if (!fiber || !fiber.currentSpan) return spans
    let current: Tracer.AnySpan | undefined = fiber.currentSpan
    let currentDepth = 0
    while (current) {
      if (maxDepth !== 0 && currentDepth >= maxDepth) break
      currentDepth++
      spans.push({
        "_tag": current._tag,
        "spanId": current.spanId,
        "traceId": current.traceId,
        "name": current._tag === "Span" ? current.name : current.spanId,
        "attributes": current._tag === "Span" && current.attributes
          ? Array.from(current.attributes.entries())
          : [],
        "stack": getSpanStack(current)
      })
      current = current._tag === "Span" && current.parent && current.parent._tag === "Some"
        ? current.parent.value
        : undefined
    }
    return spans
  }

  function getFiberCurrentContext(fiber: Fiber.Runtime<any, any>) {
    if (!fiber) return []
    return [...(fiber as any)._fiberRefs.locals.values() ?? []]
      .map((_) => _[0][1])
      .filter((_) => typeof _ === "object" && _ !== null && Symbol.for("effect/Context") in _)
      .flatMap((context) => [...context.unsafeMap.entries()])
  }

  function getAliveFibers() {
    return fibers.map((fiber) => ({
      "id": fiber.id().id.toString(),
      "isCurrent": fiber === (globalThis as any)["effect/FiberCurrent"],
      "isInterruptible": fiber && "currentRuntimeFlags" in fiber && interruptible(fiber.currentRuntimeFlags as any)
    }))
  }

  function getAutoPauseConfig() {
    return {
      "pauseOnDefects": debuggerState.pauseOnDefects
    }
  }

  function togglePauseOnDefects() {
    debuggerState = {
      ...debuggerState,
      pauseOnDefects: !debuggerState.pauseOnDefects,
      lastDefect: optionNone()
    }
  }

  function getAndUnsetPauseStateToReveal() {
    const stackEntryToReveal = debuggerState.locationToReveal
    const valuesToReveal = debuggerState.valuesToReveal
    debuggerState = {
      ...debuggerState,
      locationToReveal: optionNone(),
      valuesToReveal: []
    }
    return ({
      location: encodeOption(stackEntryToReveal, encodeStackLocation),
      values: valuesToReveal
    })
  }

  function pauseDebugger(stackEntry: StackLocation | undefined) {
    /**
     * READ ME!
     * This is a hack to pause the debugger when something happens.
     * The VSCode extension should redirect you to the location of the span,
     * if that does not happen, you can check the current span stack
     * to find out where the execution paused.
     */
    debuggerState = {
      ...debuggerState,
      locationToReveal: stackEntry ? optionSome(stackEntry) : optionNone()
    }
    // eslint-disable-next-line no-debugger
    debugger
  }

  // replace the current tracer in a fiber with a new tracer that sends events to the devtools
  const addTracerInterceptorToFiber = (fiber: Fiber.Runtime<any, any>) => {
    const _fiber = fiber as any
    // avoid to double patch the same fiber
    if (currentInstrumentationTracerKey in _fiber) return
    _fiber[currentInstrumentationTracerKey] = undefined

    const previousTracer = fiber.currentTracer
    addSetInterceptor(fiber, "currentTracer", (tracer) => {
      // avoid to double patch the same tracer
      if (!tracer) return
      if (tracer && currentInstrumentationTracerKey in tracer) return
      const _tracer = tracer as any
      _tracer[currentInstrumentationTracerKey] = true

      // patch the span method to send start and end events
      const _span = tracer.span.bind(tracer)
      tracer.span = (...args) => {
        const span = _span(...args)
        pushNotification(encodeSpan(span))

        // patch the event method to send events
        const _event = span.event.bind(span)
        span.event = (name, startTime, attributes, ...args) => {
          const result = _event(name, startTime, attributes, ...args)
          pushNotification({
            "_tag": "SpanEvent",
            "spanId": span.spanId,
            "traceId": span.traceId,
            "name": name,
            "startTime": String(startTime),
            "attributes": attributes || {}
          })
          return result
        }

        // patch the end method to send end events
        const _end = span.end.bind(span)
        span.end = (...args) => {
          const result = _end(...args)
          pushNotification(encodeSpan(span))
          return result
        }
        return span
      }

      // patch the context method to pause on errors
      const _context = tracer.context.bind(tracer)
      tracer.context = (f, fiber, ...args) => {
        const result = _context(f, fiber, ...args)

        // pause on defects
        if (debuggerState.pauseOnDefects && isExitFailure(result)) {
          const maybeDefect = causeDieOption(result.cause)
          if (maybeDefect._tag === "Some") {
            // may be wrapped in a proxy for the spanSymbol
            const currentDefect = originalInstance(maybeDefect.value)
            // only if both the defect and the span changed since the last defect
            const isSameAsLastDefect = debuggerState.lastDefect._tag === "Some" &&
              currentDefect === debuggerState.lastDefect.value.value &&
              fiber.currentSpan === debuggerState.lastDefect.value.span
            // if they changed, update the last defect and pause the debugger
            if (!isSameAsLastDefect) {
              debuggerState = {
                ...debuggerState,
                lastDefect: optionSome({ span: fiber.currentSpan, value: currentDefect }),
                valuesToReveal: [{ label: "Fiber Defect", value: currentDefect }]
              }
              const stack = fiber.currentSpan ? getSpanStack(fiber.currentSpan) : []
              pauseDebugger(stack[0])
            }
          }
        }

        return result
      }
    })
    _fiber.currentTracer = previousTracer
  }

  // notifications are with a sliding window
  const notifications: Array<Schema.Schema.Encoded<typeof Domain.Request>> = []
  const pushNotification = (notification: Schema.Schema.Encoded<typeof Domain.Request>) => {
    notifications.push(notification)
    if (notifications.length > 10000) {
      notifications.shift()
    }
  }

  function debugProtocolDevtoolsClient(
    requests: Array<Schema.Schema.Encoded<typeof Domain.Response>>
  ): string {
    const responses: Array<Schema.Schema.Encoded<typeof Domain.Request>> = []

    // handle the requests
    const hasRequestedMetrics = requests.filter((_) => _._tag === "MetricsRequest").length > 0
    if (hasRequestedMetrics) responses.push(metricsSnapshot())

    // send the responses back
    const notificationsToSend = notifications.splice(0)
    return JSON.stringify({ responses: responses.concat(notificationsToSend), instrumentationId })
  }

  // invoked each time a fiber is running
  function addTrackedFiber(fiber: Fiber.Runtime<any, any>) {
    if (fibers.indexOf(fiber) === -1) {
      // recursively track all children fibers and update the list
      addTracerInterceptorToFiber(fiber)
      fibers.push(fiber)
      if ("_children" in fiber && fiber._children !== null) {
        ;(fiber._children as Set<Fiber.Runtime<any, any>>).forEach(addTrackedFiber)
      }
      // add an observer to the fiber to remove it from the list when it is completed
      fiber.addObserver(() => {
        const index = fibers.indexOf(fiber)
        if (index > -1) {
          fibers.splice(index, 1)
        }
      })
    }
  }

  // replace the effect/FiberCurrent with a getter/setter so we can detect fibers
  // starting for the first time
  const _previousFiber = _globalThis["effect/FiberCurrent"]
  addSetInterceptor(
    _globalThis,
    "effect/FiberCurrent",
    (_: Fiber.Runtime<any, any> | undefined) => {
      if (_) addTrackedFiber(_)
    }
  )
  // trigger the setter by re-setting its value
  _globalThis["effect/FiberCurrent"] = _previousFiber
}
