import * as Schema from "effect/Schema"
import * as ExtConfig from "./core/ExtConfig.ts"

export const DevServerPort = ExtConfig.make("effect.devServer.port", {
  title: "Dev Server Port",
  description: "The port to run the Effect dev server on",
  schema: Schema.Int,
  defaultValue: 34437
})

export const MetricsPollInterval = ExtConfig.make("effect.metrics.pollInterval", {
  title: "Metrics Poll Interval",
  description: "The time in milliseconds between polling for metrics",
  schema: Schema.Int,
  defaultValue: 500
})

export const TracerPollInterval = ExtConfig.make("effect.tracer.pollInterval", {
  title: "Tracer Poll Interval",
  description: "The time in milliseconds between polling for span data while using the debug protocol transport",
  schema: Schema.Int,
  defaultValue: 250
})

export const SpanStackIgnoreList = ExtConfig.make("effect.spanStack.ignoreList", {
  title: "Span Stack Ignore List",
  description: "A list of span patterns to ignore when showing the span stack",
  schema: Schema.Array(Schema.String.pipe(Schema.annotations({ default: "" }))),
  defaultValue: []
})

export const InstrumentationInjectNodeOptions = ExtConfig.make(
  "effect.instrumentation.injectNodeOptions",
  {
    title: "Inject Node Options",
    description:
      "If enabled, the effect instrumentation code will be injected into node debug configurations by appending a NODE_OPTIONS environment variable",
    schema: Schema.Boolean,
    defaultValue: false
  }
)

export const InstrumentationInjectDebugConfigurations = ExtConfig.make(
  "effect.instrumentation.injectDebugConfigurations",
  {
    title: "Inject Debug Configurations",
    description:
      "A list of debug configuration types to inject the instrumentation into when injectNodeOptions is enabled",
    schema: Schema.Array(Schema.String),
    defaultValue: ["node", "node-terminal", "pwa-node"]
  }
)
