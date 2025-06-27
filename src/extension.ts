import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as vscode from "vscode"
import { ClientsProviderLive } from "./ClientsProvider"
import { ContextProviderLive } from "./ContextProvider"
import { CurrentSpanStackProviderLive } from "./CurrentSpanStackProvider"
import { MetricsProviderLive } from "./MetricsProvider"
import { SpanProviderLive } from "./SpanProvider"
import { VsCodeContext, launch, logger } from "./VsCode"
import { TreeCommandsLive } from "./TreeCommands"

const MainLive = Layer.mergeAll(
  ClientsProviderLive,
  ContextProviderLive,
  CurrentSpanStackProviderLive,
  SpanProviderLive,
  MetricsProviderLive,
  TreeCommandsLive,
).pipe(Layer.provide(logger("Effect Dev Tools")))

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork,
  )
}
