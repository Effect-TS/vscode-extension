import { Effect, Layer } from "effect"
import * as vscode from "vscode"
import { VsCodeContext, launch, logger } from "./VsCode"
import { SpanProviderLive } from "./SpanProvider"
import { ClientsProviderLive } from "./ClientsProvider"
import { MetricsProviderLive } from "./MetricsProvider"
import { ContextProviderLive } from "./ContextProvider"

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
