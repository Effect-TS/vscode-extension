import { Effect, Layer } from "effect"
import * as vscode from "vscode"
import { VsCodeContext, launch } from "./VsCode"
import { SpanProviderLive } from "./SpanProvider"

const MainLive = Layer.mergeAll(SpanProviderLive)

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork,
  )
}
