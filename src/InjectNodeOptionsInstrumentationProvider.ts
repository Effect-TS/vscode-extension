import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Runtime from "effect/Runtime"
import * as vscode from "vscode"
import { configWithDefault, VsCodeContext } from "./VsCode"

export const InjectNodeOptionsInstrumentationLive = Effect.gen(function*() {
  const extension = yield* VsCodeContext

  // gets the config if it shuold be injected or not
  const injectNodeOptions = yield* configWithDefault("effect.instrumentation", "injectNodeOptions", false)
  const injectDebugConfigurations = yield* configWithDefault("effect.instrumentation", "injectDebugConfigurations", [
    "node",
    "node-terminal",
    "pwa-node"
  ])
  const runtime = yield* Effect.runtime<never>()

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      vscode.debug.registerDebugConfigurationProvider("*", {
        resolveDebugConfiguration(_folder, config, _token) {
          // if disabled (default) then do nothing
          const shouldInjectBool = Runtime.runSync(runtime, injectNodeOptions.get)
          if (!shouldInjectBool) return config

          // abort immediately if the token is cancelled
          if (_token?.isCancellationRequested) return config

          // if not supported, then do nothing
          const debugConfigurations = Runtime.runSync(runtime, injectDebugConfigurations.get)
          if (
            debugConfigurations.map((_) => String(_).toLowerCase()).indexOf(config.type.toLowerCase()) === -1
          ) return config

          // if enabled, then inject the instrumentation in NODE_OPTIONS
          const configEnv = config.env || {}
          const previousNodeOptions = configEnv.NODE_OPTIONS || "${env:NODE_OPTIONS}"
          const instrumentationPath = JSON.stringify(extension.extensionPath + "/out/instrumentation.global.js")
          return {
            ...config,
            env: {
              ...configEnv,
              "NODE_OPTIONS": `--require ${instrumentationPath} ${previousNodeOptions}`
            }
          }
        }
      })
    ),
    (disposer) => Effect.sync(() => disposer.dispose())
  )
}).pipe(Layer.scopedDiscard)
