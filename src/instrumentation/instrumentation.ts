/* eslint-disable object-shorthand */
import type * as Domain from "@effect/experimental/DevTools/Domain"
import type * as MetricPair from "effect/MetricPair"
import type * as Option from "effect/Option"
import type * as Schema from "effect/Schema"
import type * as Tracer from "effect/Tracer"
import type { StackLocation } from "./encoders"
import {
  encodeMetricPairV3,
  encodeMetricSnapshotV4,
  encodeOption,
  encodeSpan,
  encodeStackLocation,
  makeStackLocation
} from "./encoders"
import {
  causeDieOptionV3,
  currentFiberKeyV3,
  globalMetricRegistrySymbol,
  globalStores,
  interruptible,
  isExitFailureV3,
  optionNone,
  optionSome,
  originalInstance
} from "./shims-v3"
import {
  causeDieOptionV4,
  contextTypeIdV4,
  currentFiberKeyV4,
  effectEvaluateV4,
  isExitFailureV4,
  metricRegistryKeyV4,
  tracerKeyV4
} from "./shims-v4"
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

interface StackFrameV4 {
  readonly stack: () => string | undefined
  readonly parent: StackFrameV4 | undefined
}

type RuntimeFiber = any

const instrumentationKey = "effect/devtools/instrumentation"
const currentInstrumentationTracerKey = "effect/instrumentation/currentTracer"

// first inject the logic to track current and newly created fibers
if (!(instrumentationKey in globalThis)) {
  const _globalThis = globalThis as any
  // local state of the instrumentation
  const fibers: Array<RuntimeFiber> = []
  const fiberStartTimes = new WeakMap<object, number>()
  const metricRegistriesV4: Array<{ context: any; registry: Map<string, any> }> = []
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
    "getCurrentFiber": getCurrentFiber,
    "getFiberCurrentSpanStack": getFiberCurrentSpanStack,
    "getFiberCurrentContext": getFiberCurrentContext,
    "getAliveFibers": getAliveFibers,
    "interruptFiber": interruptFiber,
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
        const encoded = encodeMetricPairV3(snapshot[i])
        if (encoded) {
          metrics.push(encoded)
        }
      }
    }

    for (let i = 0; i < fibers.length; i++) {
      trackMetricRegistryV4(fibers[i])
    }
    for (let i = 0; i < metricRegistriesV4.length; i++) {
      const { context, registry } = metricRegistriesV4[i]
      for (const metadata of registry.values()) {
        if (!metadata || !metadata.hooks || typeof metadata.hooks.get !== "function") continue
        const encoded = encodeMetricSnapshotV4({
          id: metadata.id,
          type: metadata.type,
          description: metadata.description,
          attributes: metadata.attributes,
          state: metadata.hooks.get(context)
        })
        if (encoded) metrics.push(encoded)
      }
    }

    return {
      "_tag": "MetricsSnapshot",
      "metrics": metrics
    }
  }

  function trackMetricRegistryV4(fiber: RuntimeFiber) {
    const context = fiber && fiber.context
    const registry = context && context.mapUnsafe && context.mapUnsafe.get(metricRegistryKeyV4)
    if (!(registry instanceof Map)) return
    for (let i = 0; i < metricRegistriesV4.length; i++) {
      if (metricRegistriesV4[i].registry === registry) {
        metricRegistriesV4[i].context = context
        return
      }
    }
    metricRegistriesV4.push({ context, registry })
  }

  function parseStack(stackString: string): Array<StackLocation> {
    const stack = stackString.split("\n").filter((_) => String(_).length > 0)
    const out: Array<StackLocation> = []
    for (let i = 0; i < stack.length; i++) {
      const line = stack[i].trim()
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

  function getSpanStack(span: Tracer.AnySpan): Array<StackLocation> {
    const stackString: string = globalStores().reduce((acc, store) => {
      if (acc || !store) return acc
      const spanToTrace = store.get("effect/Tracer/spanToTrace")
      const stackFn = spanToTrace ? spanToTrace.get(span) : acc
      return stackFn ? stackFn() : acc
    }, undefined) || ""
    return parseStack(stackString)
  }

  function getFiberCurrentSpanStack(fiber: RuntimeFiber, maxDepth: number) {
    const spans: Array<any> = []
    if (!fiber || !fiber.currentSpan) return spans
    let current: Tracer.AnySpan | undefined = fiber.currentSpan
    let currentStackFrame: StackFrameV4 | undefined = fiber.currentStackFrame
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
        "stack": currentStackFrame && typeof currentStackFrame.stack === "function"
          ? parseStack(currentStackFrame.stack() || "")
          : getSpanStack(current)
      })
      currentStackFrame = currentStackFrame && currentStackFrame.parent
      current = current._tag === "Span" && current.parent && current.parent._tag === "Some"
        ? current.parent.value
        : undefined
    }
    return spans
  }

  function getFiberCurrentContext(fiber: RuntimeFiber) {
    if (!fiber) return []
    if (fiber.context && fiber.context.mapUnsafe && contextTypeIdV4 in fiber.context) {
      return [...fiber.context.mapUnsafe.entries()]
    }
    return [...(fiber as any)._fiberRefs.locals.values() ?? []]
      .map((_) => _[0][1])
      .filter((_) => typeof _ === "object" && _ !== null && Symbol.for("effect/Context") in _)
      .flatMap((context) => [...context.unsafeMap.entries()])
  }

  function getCurrentFiber(): RuntimeFiber | undefined {
    return _globalThis[currentFiberKeyV4] || _globalThis[currentFiberKeyV3]
  }

  function encodeFiberId(fiber: RuntimeFiber) {
    return String(typeof fiber.id === "function" ? fiber.id().id : fiber.id)
  }

  function getAliveFibers() {
    return fibers.map((fiber) => ({
      "id": encodeFiberId(fiber),
      "isCurrent": fiber === getCurrentFiber(),
      "isInterruptible": typeof fiber.interruptible === "boolean"
        ? fiber.interruptible
        : fiber && "currentRuntimeFlags" in fiber && interruptible(fiber.currentRuntimeFlags as any),
      "isInterrupted": fiber && "isInterrupted" in fiber && typeof fiber.isInterrupted === "function"
        ? fiber.isInterrupted()
        : fiber && fiber._interruptedCause !== undefined,
      "children": "getChildren" in fiber && typeof fiber.getChildren === "function"
        ? [...fiber.getChildren()].map(encodeFiberId)
        : fiber._children instanceof Set
        ? [...fiber._children].map(encodeFiberId)
        : [],
      "startTimeMillis": typeof fiber.id === "function" ? fiber.id().startTimeMillis : fiberStartTimes.get(fiber)!,
      "lifeTimeMillis": Date.now() -
        (typeof fiber.id === "function" ? fiber.id().startTimeMillis : fiberStartTimes.get(fiber)!)
    }))
  }

  function interruptFiber(fiberId: string) {
    fibers.forEach((fiber) => {
      if (encodeFiberId(fiber) !== fiberId) return
      if (typeof fiber.unsafeInterruptAsFork === "function") fiber.unsafeInterruptAsFork(fiber.id())
      else if (typeof fiber.interruptUnsafe === "function") fiber.interruptUnsafe(fiber.id)
    })
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

  const patchedTracers = new WeakSet<object>()
  const patchedSpans = new WeakSet<object>()

  function handleEvaluationResult(result: unknown, fiber: RuntimeFiber) {
    if (!debuggerState.pauseOnDefects) return
    const maybeDefect = isExitFailureV4(result)
      ? causeDieOptionV4(result.cause)
      : isExitFailureV3(result)
      ? causeDieOptionV3(result.cause)
      : optionNone()
    if (maybeDefect._tag === "None") return

    // V3 defects may be wrapped in a proxy carrying the original annotation.
    const currentDefect = originalInstance(maybeDefect.value)
    const isSameAsLastDefect = debuggerState.lastDefect._tag === "Some" &&
      currentDefect === debuggerState.lastDefect.value.value &&
      fiber.currentSpan === debuggerState.lastDefect.value.span
    if (isSameAsLastDefect) return

    debuggerState = {
      ...debuggerState,
      lastDefect: optionSome({ span: fiber.currentSpan, value: currentDefect }),
      valuesToReveal: [{ label: "Fiber Defect", value: currentDefect }]
    }
    const stack = fiber.currentStackFrame && typeof fiber.currentStackFrame.stack === "function"
      ? parseStack(fiber.currentStackFrame.stack() || "")
      : fiber.currentSpan
      ? getSpanStack(fiber.currentSpan)
      : []
    pauseDebugger(stack[0])
  }

  function patchSpan(span: any) {
    if (!span || patchedSpans.has(span)) return
    patchedSpans.add(span)
    pushNotification(encodeSpan(span))

    const eventV3OrV4 = span.event.bind(span)
    span.event = (name: string, startTime: bigint, attributes: Record<string, unknown>, ...args: Array<any>) => {
      const result = eventV3OrV4(name, startTime, attributes, ...args)
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

    const endV3OrV4 = span.end.bind(span)
    span.end = (...args: Array<any>) => {
      const result = endV3OrV4(...args)
      pushNotification(encodeSpan(span))
      return result
    }
  }

  function patchTracerV3OrV4(tracer: any) {
    if (!tracer || typeof tracer.span !== "function" || patchedTracers.has(tracer)) return
    patchedTracers.add(tracer)

    const spanV3OrV4 = tracer.span.bind(tracer)
    tracer.span = (...args: Array<any>) => {
      const span = spanV3OrV4(...args)
      patchSpan(span)
      return span
    }

    if (typeof tracer.context === "function") {
      const contextV3OrV4 = tracer.context.bind(tracer)
      tracer.context = (primitive: any, fiber: RuntimeFiber, ...args: Array<any>) => {
        const result = contextV3OrV4(primitive, fiber, ...args)
        handleEvaluationResult(result, fiber)
        return result
      }
    }
  }

  function addTracerInterceptorToFiberV3(fiber: RuntimeFiber) {
    const previousTracer = fiber.currentTracer
    addSetInterceptor(fiber, "currentTracer", patchTracerV3OrV4)
    fiber.currentTracer = previousTracer
  }

  function installEvaluationContextV4(fiber: RuntimeFiber) {
    const contextV4 = fiber.currentTracerContext
    if (contextV4 && currentInstrumentationTracerKey in contextV4) return
    const wrapped = (primitive: any, currentFiber: RuntimeFiber) => {
      const result = contextV4
        ? contextV4.call(fiber, primitive, currentFiber)
        : primitive[effectEvaluateV4](currentFiber)
      handleEvaluationResult(result, currentFiber)
      return result
    }
    wrapped[currentInstrumentationTracerKey] = true
    fiber.currentTracerContext = wrapped
  }

  function addTracerInterceptorToFiberV4(fiber: RuntimeFiber) {
    const getRefV4 = fiber.getRef
    fiber.getRef = (ref: any) => {
      const value = getRefV4.call(fiber, ref)
      if (ref && ref.key === tracerKeyV4) patchTracerV3OrV4(value)
      return value
    }

    const tracer = fiber.context && fiber.context.mapUnsafe && fiber.context.mapUnsafe.get(tracerKeyV4)
    patchTracerV3OrV4(tracer)

    const setContextV4 = fiber.setContext
    fiber.setContext = (context: any) => {
      setContextV4.call(fiber, context)
      trackMetricRegistryV4(fiber)
      installEvaluationContextV4(fiber)
    }
    installEvaluationContextV4(fiber)
  }

  // Replace the active tracer lookup with one that sends events to the devtools.
  function addTracerInterceptorToFiber(fiber: RuntimeFiber) {
    if (currentInstrumentationTracerKey in fiber) return
    fiber[currentInstrumentationTracerKey] = true
    if (typeof fiber.id === "function") addTracerInterceptorToFiberV3(fiber)
    else addTracerInterceptorToFiberV4(fiber)
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
  function addTrackedFiber(fiber: RuntimeFiber) {
    trackMetricRegistryV4(fiber)
    if (fibers.indexOf(fiber) === -1) {
      // recursively track all children fibers and update the list
      fiberStartTimes.set(fiber, Date.now())
      addTracerInterceptorToFiber(fiber)
      fibers.push(fiber)
      if ("_children" in fiber && fiber._children != null) {
        ;(fiber._children as Set<RuntimeFiber>).forEach(addTrackedFiber)
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

  function addCurrentFiberInterceptor(key: string) {
    const previousFiber = _globalThis[key]
    addSetInterceptor(_globalThis, key, (fiber: RuntimeFiber | undefined) => {
      if (fiber) addTrackedFiber(fiber)
    })
    // Trigger the setter by re-setting its value.
    _globalThis[key] = previousFiber
  }

  addCurrentFiberInterceptor(currentFiberKeyV3)
  addCurrentFiberInterceptor(currentFiberKeyV4)
}
