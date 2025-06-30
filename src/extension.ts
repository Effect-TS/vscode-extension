import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as vscode from "vscode"
import { ClientsProviderLive } from "./ClientsProvider"
import { ContextProviderLive } from "./ContextProvider"
import { DebugFibersProviderLive } from "./DebugFibersProvider"
import { DebugSpanStackProviderLive } from "./DebugSpanStackProvider"
import { MetricsProviderLive } from "./MetricsProvider"
import { SpanProviderLive } from "./SpanProvider"
import { TreeCommandsLive } from "./TreeCommands"
import { launch, logger, VsCodeContext } from "./VsCode"

const MainLive = Layer.mergeAll(
  ClientsProviderLive,
  ContextProviderLive,
  DebugSpanStackProviderLive,
  SpanProviderLive,
  MetricsProviderLive,
  TreeCommandsLive,
  DebugFibersProviderLive
).pipe(Layer.provide(logger("Effect Dev Tools")))

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork
  )
}
