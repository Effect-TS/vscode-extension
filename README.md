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
const DevToolsLive = DevTools.layer()

program.pipe(Effect.provide(DevToolsLive), NodeRuntime.runMain)
```

The code above expects the DevTools server to be available at `localhost:34437`. If you are not running the DevTools client (e. g. backend) on the same machine, or if it's not available at localhost, you'll have to manully specify the websocket server url like so:
```ts
const DevToolsLive = DevTools.layer('ws://localhost:34437')
```

If you are using `@effect/opentelemetry` in your project, then it is important that you provide the `DevTools` layer **before** your tracing layers, so the tracer is patched correctly.

Beware, that Effect DevTools extension does not behave like typical debugger UI, which connects to debugger port of target process. It's the other way around here. One of the reasons for that is to enable tracing of web applications, which are not able to expose ports, as servers do.

### Docker

In case you're using docker for local development and want to connect from your containerized application to DevTools server in VS Code, you'll have to do 2 things.

1. You'll have to make your host machine addressable from within the container, by adding extra host.

```yaml
services:
  effect-backend:
    extra_hosts:
      - host.docker.internal:host-gateway
```

2. You'll have to specify connection URL in your application to be

```ts
DevTools.layer('ws://host.docker.internal:34437');
```

## Usage

Once you have added the Layer to your project, open the Effect Dev Tools panel in vscode & click "Start the server" in the "Clients" panel.

You can then start your Effect app, and then begin to inspect the results!
