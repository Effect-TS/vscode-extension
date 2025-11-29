import * as Schema from "effect/Schema"
import * as ExtCommand from "./core/ExtCommand.ts"
import * as ExtIcon from "./core/ExtIcon.ts"
import * as ExtWhenClause from "./core/ExtWhenClause.ts"
import * as Inputs from "./DevtoolInputs.ts"

export const DebugContextRefresh = ExtCommand.make("effect.debugContextRefresh", {
  title: "Refresh Debug Context",
  icon: ExtIcon.refresh
})

export const DebugFibersRefresh = ExtCommand.make("effect.debugFibersRefresh", {
  title: "Refresh Debug Fibers",
  icon: ExtIcon.refresh
})

export const DebugSpanStackRefresh = ExtCommand.make("effect.debugSpanStackRefresh", {
  title: "Refresh Debug Span Stack",
  icon: ExtIcon.refresh
})

export const StartServer = ExtCommand.make("effect.startServer", {
  title: "Start Server",
  icon: ExtIcon.play,
  enablement: ExtWhenClause.equals(Inputs.running, ExtWhenClause.falseLiteral)
})

export const StopServer = ExtCommand.make("effect.stopServer", {
  title: "Stop Server",
  icon: ExtIcon.debugStop,
  enablement: ExtWhenClause.equals(Inputs.running, ExtWhenClause.trueLiteral)
})

export const AttachDebugSessionClient = ExtCommand.make("effect.attachDebugSessionClient", {
  title: "Attach Debug Session Client",
  icon: ExtIcon.debug,
  enablement: Inputs.hasDebugTargets
})

export const ResetMetrics = ExtCommand.make("effect.resetMetrics", {
  title: "Reset Metrics",
  icon: ExtIcon.refresh
})

export const ResetTracer = ExtCommand.make("effect.resetTracer", {
  title: "Reset Tracer",
  icon: ExtIcon.refresh
})

export const CopyInfoValue = ExtCommand.make("effect.copyInfoValue", {
  title: "Copy value",
  icon: ExtIcon.copy
})

export const RevealSpanLocation = ExtCommand.make("effect.revealSpanLocation", {
  title: "Reveal Span Location",
  icon: ExtIcon.goToFile,
  payload: Schema.Struct({
    traceId: Schema.NonEmptyTrimmedString,
    spanId: Schema.NonEmptyTrimmedString,
    stackIdx: Schema.Int
  })
})

export const RevealFiberCurrentSpan = ExtCommand.make("effect.revealFiberCurrentSpan", {
  title: "Reveal Fiber Current Span Location",
  icon: ExtIcon.goToFile,
  payload: Schema.Struct({
    fiberId: Schema.NonEmptyTrimmedString
  })
})

export const InterruptDebugFiber = ExtCommand.make("effect.interruptDebugFiber", {
  title: "Interrupt Fiber",
  icon: ExtIcon.debugStop,
  payload: Schema.Struct({
    fiberId: Schema.NonEmptyTrimmedString
  }),
  enablement: Inputs.inDebugMode
})

export const ResetTracerExtended = ExtCommand.make("effect.resetTracerExtended", {
  title: "Reset Tracer Extended",
  icon: ExtIcon.refresh
})

export const EnableSpanStackIgnoreList = ExtCommand.make("effect.enableSpanStackIgnoreList", {
  title: "Enable Span Stack Ignore List",
  icon: ExtIcon.eyeClosed,
  enablement: ExtWhenClause.equals(Inputs.spanStackIgnoreListEnabled, ExtWhenClause.falseLiteral)
})

export const DisableSpanStackIgnoreList = ExtCommand.make("effect.disableSpanStackIgnoreList", {
  title: "Disable Span Stack Ignore List",
  icon: ExtIcon.eye,
  enablement: ExtWhenClause.equals(Inputs.spanStackIgnoreListEnabled, ExtWhenClause.trueLiteral)
})

export const ShowLayerMermaid = ExtCommand.make("effect.showLayerMermaid", {
  title: "Show Layer Mermaid Graph (locally)"
})

export const TogglePauseOnDefects = ExtCommand.make("effect.togglePauseOnDefects", {
  title: "Toggle Pause on Defects",
  payload: Schema.Struct({
    threadId: Schema.UndefinedOr(Schema.Number)
  }),
  enablement: Inputs.inDebugMode
})

export const SelectClient = ExtCommand.make("effect.selectClient", {
  title: "Select Client",
  payload: Schema.Struct({
    clientId: Schema.Number
  }),
  enablement: Inputs.hasClients
})
