import * as Schema from "effect/Schema"
import * as DevtoolCommand from "../core/DevtoolCommand.js"
import * as DevtoolIcon from "../core/DevtoolIcon.js"

export const StartServer = DevtoolCommand.make("effect.startServer", {
  title: "Effect Dev Tools: Start Server",
  icon: DevtoolIcon.play,
  payload: Schema.Struct({}),
  success: Schema.Void,
  error: Schema.Never
})

export const StopServer = DevtoolCommand.make("effect.stopServer", {
  title: "Effect Dev Tools: Stop Server",
  icon: DevtoolIcon.debugStop,
  success: Schema.Void,
  error: Schema.Never
})

export const AttachDebugSessionClient = DevtoolCommand.make("effect.attachDebugSessionClient", {
  title: "Effect Dev Tools: Attach Debug Session Client",
  icon: DevtoolIcon.debug,
  success: Schema.Void,
  error: Schema.Never
})

export const ResetMetrics = DevtoolCommand.make("effect.resetMetrics", {
  title: "Effect Dev Tools: Reset Metrics",
  icon: DevtoolIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const ResetTracer = DevtoolCommand.make("effect.resetTracer", {
  title: "Effect Dev Tools: Reset Tracer",
  icon: DevtoolIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const CopyInfoValue = DevtoolCommand.make("effect.copyInfoValue", {
  title: "Copy value",
  icon: DevtoolIcon.copy,
  success: Schema.Void,
  error: Schema.Never
})

export const RevealSpanLocation = DevtoolCommand.make("effect.revealSpanLocation", {
  title: "Effect Dev Tools: Reveal Span Location",
  icon: DevtoolIcon.goToFile,
  success: Schema.Void,
  error: Schema.Never
})

export const RevealFiberCurrentSpan = DevtoolCommand.make("effect.revealFiberCurrentSpan", {
  title: "Effect Dev Tools: Reveal Fiber Current Span Location",
  icon: DevtoolIcon.goToFile,
  success: Schema.Void,
  error: Schema.Never
})

export const ResetTracerExtended = DevtoolCommand.make("effect.resetTracerExtended", {
  title: "Effect Dev Tools: Reset Tracer Extended",
  icon: DevtoolIcon.refresh,
  success: Schema.Void,
  error: Schema.Never
})

export const EnableSpanStackIgnoreList = DevtoolCommand.make("effect.enableSpanStackIgnoreList", {
  title: "Effect Dev Tools: Enable Span Stack Ignore List",
  icon: DevtoolIcon.eyeClosed,
  success: Schema.Void,
  error: Schema.Never
})

export const DisableSpanStackIgnoreList = DevtoolCommand.make("effect.disableSpanStackIgnoreList", {
  title: "Effect Dev Tools: Disable Span Stack Ignore List",
  icon: DevtoolIcon.eye,
  success: Schema.Void,
  error: Schema.Never
})

export const ShowLayerMermaid = DevtoolCommand.make("effect.showLayerMermaid", {
  title: "Effect Dev Tools: Show Layer Mermaid Graph (locally)",
  success: Schema.Void,
  error: Schema.Never
})

export const TogglePauseOnDefects = DevtoolCommand.make("effect.togglePauseOnDefects", {
  title: "Effect Dev Tools: Toggle Pause on Defects",
  success: Schema.Void,
  error: Schema.Never
})
