# Effect Dev Tools

View traces, metrics and inspect the context for your Effect app - all without leaving VSCode!

## Setup

To use Effect Dev Tools in your Effect project, first you need to install the following dependency:

```
pnpm install @effect/experimental
```

You can then import and use the `DevTools` module in your Effect app:

```ts
import { DevTools } from "@effect/experimental"
import { NodeRuntime, NodeSocket } from "@effect/platform-node"
import { Effect, Layer } from "effect"

const program = Effect.log("Hello!").pipe(
  Effect.delay(2000),
  Effect.withSpan("Hi", { attributes: { foo: "bar" } }),
  Effect.forever,
)
const DevToolsLive = DevTools.layerWebSocket().pipe(
  Layer.provide(NodeSocket.layerWebSocketConstructor),
)

program.pipe(Effect.provide(DevToolsLive), NodeRuntime.runMain)
```

If you are using `@effect/opentelemetry` in your project, then it is important that you provide the `DevTools` layer **before** your tracing layers, so the tracer is patched correctly.

## Usage

Once you have added the Layer to your project, open the Effect Dev Tools panel in vscode & click "Start the server" in the "Clients" panel.

You can then start your Effect app, and then begin to inspect the results!
