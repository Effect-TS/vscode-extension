import * as Schema from "effect/Schema"
import * as ExtCommand from "./core/ExtCommand.ts"
import * as ExtIcon from "./core/ExtIcon.ts"
import * as ExtWhenClause from "./core/ExtWhenClause.ts"
import * as Inputs from "./DevtoolInputs.ts"

export const RefreshDebugContext = ExtCommand.make("effect.refreshDebugContext", {
  title: "Refresh Debug Context",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const RefreshDebugFibers = ExtCommand.make("effect.refreshDebugFibers", {
  title: "Refresh Debug Fibers",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const RefreshDebugSpanStack = ExtCommand.make("effect.refreshDebugSpanStack", {
  title: "Refresh Debug Span Stack",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const StartServer = ExtCommand.make("effect.startServer", {
  title: "Start Server",
  icon: ExtIcon.play,
  success: Schema.Void,
  error: Schema.Never,
  enablement: ExtWhenClause.equals(Inputs.running, ExtWhenClause.falseLiteral)
})

export const StopServer = ExtCommand.make("effect.stopServer", {
  title: "Stop Server",
  icon: ExtIcon.debugStop,
  success: Schema.Void,
  error: Schema.Never,
  enablement: ExtWhenClause.equals(Inputs.running, ExtWhenClause.trueLiteral)
})

export const AttachDebugSessionClient = ExtCommand.make("effect.attachDebugSessionClient", {
  title: "Attach Debug Session Client",
  icon: ExtIcon.debug,
  success: Schema.Void,
  error: Schema.Never,
  enablement: Inputs.hasDebugTargets
})

export const ResetMetrics = ExtCommand.make("effect.resetMetrics", {
  title: "Reset Metrics",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const ResetTracer = ExtCommand.make("effect.resetTracer", {
  title: "Reset Tracer",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const CopyInfoValue = ExtCommand.make("effect.copyInfoValue", {
  title: "Copy value",
  icon: ExtIcon.copy,
  success: Schema.Void,
  error: Schema.Never
})

export const RevealSpanLocation = ExtCommand.make("effect.revealSpanLocation", {
  title: "Reveal Span Location",
  icon: ExtIcon.goToFile,
  payload: Schema.Struct({
    traceId: Schema.NonEmptyTrimmedString,
    spanId: Schema.NonEmptyTrimmedString,
    stackIdx: Schema.Int
  }),
  success: Schema.Void,
  error: Schema.Never
})

export const RevealFiberCurrentSpan = ExtCommand.make("effect.revealFiberCurrentSpan", {
  title: "Reveal Fiber Current Span Location",
  icon: ExtIcon.goToFile,
  payload: Schema.Struct({
    fiberId: Schema.NonEmptyTrimmedString
  }),
  success: Schema.Void,
  error: Schema.Never
})

export const InterruptDebugFiber = ExtCommand.make("effect.interruptDebugFiber", {
  title: "Interrupt Fiber",
  icon: ExtIcon.debugStop,
  payload: Schema.Struct({
    fiberId: Schema.NonEmptyTrimmedString
  }),
  success: Schema.Void,
  error: Schema.Never,
  enablement: Inputs.inDebugMode
})

export const ResetTracerExtended = ExtCommand.make("effect.resetTracerExtended", {
  title: "Reset Tracer Extended",
  icon: ExtIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const EnableSpanStackIgnoreList = ExtCommand.make("effect.enableSpanStackIgnoreList", {
  title: "Enable Span Stack Ignore List",
  icon: ExtIcon.eyeClosed,
  success: Schema.Void,
  error: Schema.Never,
  enablement: ExtWhenClause.equals(Inputs.spanStackIgnoreListEnabled, ExtWhenClause.falseLiteral)
})

export const DisableSpanStackIgnoreList = ExtCommand.make("effect.disableSpanStackIgnoreList", {
  title: "Disable Span Stack Ignore List",
  icon: ExtIcon.eye,
  success: Schema.Void,
  error: Schema.Never,
  enablement: ExtWhenClause.equals(Inputs.spanStackIgnoreListEnabled, ExtWhenClause.trueLiteral)
})

export const ShowLayerMermaid = ExtCommand.make("effect.showLayerMermaid", {
  title: "Show Layer Mermaid Graph (locally)",
  success: Schema.Void,
  error: Schema.Never
})

export const TogglePauseOnDefects = ExtCommand.make("effect.togglePauseOnDefects", {
  title: "Toggle Pause on Defects",
  payload: Schema.Struct({
    threadId: Schema.UndefinedOr(Schema.Number)
  }),
  success: Schema.Void,
  error: Schema.Never,
  enablement: Inputs.inDebugMode
})

export const SelectClient = ExtCommand.make("effect.selectClient", {
  title: "Select Client",
  payload: Schema.Struct({
    clientId: Schema.Number
  }),
  success: Schema.Void,
  error: Schema.Never,
  enablement: Inputs.hasClients
})
