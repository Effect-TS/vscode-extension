import * as Schema from "effect/Schema"
import * as DevtoolConfig from "../core/DevtoolConfig.js"

export const DevServerPort = DevtoolConfig.make("effect.devServer.port", {
  description: "The port to run the Effect dev server on",
  schema: Schema.Int,
  defaultValue: 34437
})

export const MetricsPollInterval = DevtoolConfig.make("effect.metrics.pollInterval", {
  description: "The time in milliseconds between polling for metrics",
  schema: Schema.Int,
  defaultValue: 500
})

export const TracerPollInterval = DevtoolConfig.make("effect.tracer.pollInterval", {
  description: "The time in milliseconds between polling for span data while using the debug protocol transport",
  schema: Schema.Int,
  defaultValue: 250
})

export const SpanStackIgnoreList = DevtoolConfig.make("effect.spanStack.ignoreList", {
  description: "A list of span patterns to ignore when showing the span stack",
  schema: Schema.Array(Schema.String),
  defaultValue: []
})

export const InstrumentationInjectNodeOptions = DevtoolConfig.make(
  "effect.instrumentation.injectNodeOptions",
  {
    description:
      "If enabled, the effect instrumentation code will be injected into node debug configurations by appending a NODE_OPTIONS environment variable",
    schema: Schema.Boolean,
    defaultValue: false
  }
)

export const InstrumentationInjectDebugConfigurations = DevtoolConfig.make(
  "effect.instrumentation.injectDebugConfigurations",
  {
    description:
      "A list of debug configuration types to inject the instrumentation into when injectNodeOptions is enabled",
    schema: Schema.Array(Schema.String),
    defaultValue: ["node", "node-terminal", "pwa-node"]
  }
)
