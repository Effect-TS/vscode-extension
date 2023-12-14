import { Effect, Layer } from "effect"
import * as vscode from "vscode"
import { ClientsProviderLive } from "./ClientsProvider"
import { ContextProviderLive } from "./ContextProvider"
import { MetricsProviderLive } from "./MetricsProvider"
import { SpanProviderLive } from "./SpanProvider"
import { VsCodeContext, launch, logger } from "./VsCode"

const MainLive = Layer.mergeAll(
  ClientsProviderLive,
  ContextProviderLive,
  SpanProviderLive,
  MetricsProviderLive,
).pipe(Layer.provide(logger("Effect Dev Tools")))

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork,
  )
}
