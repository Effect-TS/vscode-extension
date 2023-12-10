import { Effect, Layer } from "effect"
import * as vscode from "vscode"
import { VsCodeContext, launch, vsCodeLogger } from "./VsCode"
import { SpanProviderLive } from "./SpanProvider"
import { ClientsProviderLive } from "./ClientsProvider"

const MainLive = Layer.mergeAll(SpanProviderLive, ClientsProviderLive).pipe(
  Layer.provide(vsCodeLogger("Effect Dev Tools")),
)

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork,
  )
}
