import type * as Fiber from "effect/Fiber"
import type * as Tracer from "effect/Tracer"
import * as ProtocolDecoder from "./ProtocolDecoder.generated.ts"
import * as ProtocolEncoder from "./ProtocolEncoder.generated.ts"
import { addSetInterceptor } from "./utils.ts"

type GlobalWithFiberCurrent = {
  "effect/FiberCurrent": Fiber.RuntimeFiber<any, any> | undefined
  __EFFECT_DEVTOOLS_BINDING_BRIDGE?: (message: string) => void
  "@effect/devtools-instrumentation"?: {
    send: (message: string) => void
    onmessage: (message: string) => void
  }
}

const _globalThis: GlobalWithFiberCurrent = globalThis as any

function ensureInstrumentationIsInitialized() {
  if ("@effect/devtools-instrumentation" in _globalThis) return
  const instrumentation = createInstrumentation((message) => {
    _globalThis["@effect/devtools-instrumentation"]?.onmessage(message)
  })
  _globalThis["@effect/devtools-instrumentation"] = {
    send: instrumentation.handleMessage,
    onmessage: (message: string) => {
      if (_globalThis.__EFFECT_DEVTOOLS_BINDING_BRIDGE) {
        _globalThis.__EFFECT_DEVTOOLS_BINDING_BRIDGE(message)
      }
    }
  }
  addSetInterceptor(_globalThis, "effect/FiberCurrent", (newFiber) => {
    if (newFiber) instrumentation.ensureFiberIsTracked(newFiber)
  })
  if (_globalThis["effect/FiberCurrent"]) {
    instrumentation.ensureFiberIsTracked(_globalThis["effect/FiberCurrent"])
  }
  instrumentation.sendPingNotification()
}

function createInstrumentation(
  onMessage: (notification: string) => void
) {
  // generate a unique instrumentation id
  const instrumentationId = Math.random().toString(36).substring(2, 15)
  const protocolVersion = 1
  // emits a response/notification to the devtools client
  function sendBack(event: ProtocolEncoder.OutMessage) {
    try {
      const encodedEvent = ProtocolEncoder.OutMessage(event)
      if (encodedEvent._tag === "Success") {
        const message = JSON.stringify(encodedEvent)
        onMessage(message)
      }
    } finally {
      /* empty */
    }
  }

  // handles incoming messages from the devtools client
  function handleMessage(message: string) {
    // decode the message
    let request: ProtocolDecoder.InMessage | undefined = undefined
    try {
      const decodedMessage = ProtocolDecoder.InMessage(message)
      if (decodedMessage._tag === "Success") {
        request = decodedMessage.value
      }
    } finally {
      /* empty */
    }
    if (!request) return
    // handle the request
    switch (request._tag) {
      case "CaptureCurrentFibersRequest":
        return handleCaptureCurrentFibersRequest(request)
      case "VariableReferenceInfoRequest":
        return handleRequestVariableReferenceInfo(request)
      case "ReleaseResourcesForRequest":
        return handleReleaseResourcesForRequest(request)
      default:
        break
    }
  }

  // ensure we keep a list of all fibers that are running
  const fibers: Array<Fiber.RuntimeFiber<any, any>> = []
  function ensureFiberIsTracked(fiber: Fiber.RuntimeFiber<any, any>) {
    if (!fiber) return
    if (fibers.indexOf(fiber) === -1) {
      fibers.push(fiber)
      // patch the fiber so that
      ensureTracerIsTracked(fiber.currentTracer)
      // recursively track all children fibers and update the list
      if ("_children" in fiber && fiber._children !== null) {
        ;(fiber._children as Set<Fiber.RuntimeFiber<any, any>>).forEach(ensureFiberIsTracked)
      }
      // add an observer to the fiber to remove it from the list when it is completed
      fiber.addObserver(() => {
        const index = fibers.indexOf(fiber)
        if (index > -1) fibers.splice(index, 1)
      })
    }
  }

  // ensure we patch all the tracers that we find
  const patchedTracer = new WeakSet<Tracer.Tracer>()
  function ensureTracerIsTracked(currentTracer: Tracer.Tracer) {
    if (!currentTracer) return
    if (patchedTracer.has(currentTracer)) return
    patchedTracer.add(currentTracer)

    const oldSpanConstructor = currentTracer.span
    currentTracer.span = function() {
      const span = oldSpanConstructor.apply(this, arguments as any)
      // addNode(span)

      const oldSpanEnd = span.end
      span.end = function() {
        oldSpanEnd.apply(this, arguments as any)
        // addNodeExit(this.traceId, this.spanId, exit)
      }

      const oldSpanEvent = span.event
      span.event = function() {
        oldSpanEvent.apply(this, arguments as any)
        // addEvent(this.traceId, this.spanId, { name, startTime, attributes })
      }

      return span
    }

    const oldContext = currentTracer.context
    currentTracer.context = function(f, fiber) {
      const context = oldContext.apply(this, arguments as any)
      ensureFiberIsTracked(fiber)
      ensureTracerIsTracked(fiber.currentTracer)
      return context as any
    }
  }

  const resources = new Map<ProtocolDecoder.RequestId, Array<[name: string | null, value: any]>>()
  function _captureResource(
    requestId: ProtocolDecoder.RequestId,
    propertyName: string | null,
    value: any
  ): ProtocolEncoder.VariableReferenceId {
    const vars = resources.get(requestId) || []
    const index = vars.push([propertyName, value])
    return {
      _tag: "VariableReference",
      instrumentationId,
      requestId,
      index: String(index)
    }
  }

  function handleRequestVariableReferenceInfo(
    req: ProtocolDecoder.VariableReferenceInfoRequest
  ) {
    if (req.variableReferenceId.instrumentationId !== instrumentationId) return
    const vars = resources.get(req.requestId)
    if (!vars) {
      return sendBack({
        _tag: "VariableReferenceInfo",
        protocolVersion,
        instrumentationId,
        variableReferenceId: req.variableReferenceId,
        value: null
      })
    }
    // const [name, _value] = vars[Number(req.variableReferenceId.index)]

    return sendBack({
      _tag: "VariableReferenceInfo",
      protocolVersion,
      instrumentationId,
      variableReferenceId: req.variableReferenceId,
      value: {
        name: null,
        value: "",
        children: []
      }
    })
  }

  function handleReleaseResourcesForRequest(
    req: ProtocolDecoder.ReleaseResourcesForRequest
  ) {
    req.associatedRequestIds.forEach((requestId) => resources.delete(requestId))
    return sendBack({
      _tag: "ResourcesForRequestReleased",
      protocolVersion,
      instrumentationId,
      associatedRequestIds: req.associatedRequestIds
    })
  }

  function handleCaptureCurrentFibersRequest(
    req: ProtocolDecoder.CaptureCurrentFibersRequest
  ) {
    return sendBack({
      _tag: "CurrentFibersInfo",
      protocolVersion,
      instrumentationId,
      requestId: req.requestId,
      fibers: fibers.map((fiber) => ({
        _tag: "FiberInfo",
        id: globalThis.String(fiber.id().id),
        isCurrent: _globalThis["effect/FiberCurrent"] === fiber
      }))
    })
  }

  function sendPingNotification() {
    return sendBack({
      _tag: "PingNotification",
      protocolVersion,
      instrumentationId
    })
  }

  return {
    ensureFiberIsTracked,
    ensureTracerIsTracked,
    instrumentationId,
    handleMessage,
    sendPingNotification
  }
}

ensureInstrumentationIsInitialized()
