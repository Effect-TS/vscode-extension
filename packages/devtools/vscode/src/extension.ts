import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as vscode from "vscode"
import { ClientsLive } from "./Clients.ts"
import { InitialContributes, VscodeExtension } from "./contributes.ts"
import { InjectNodeOptionsInstrumentationLive } from "./InjectNodeOptionsInstrumentationProvider.ts"
import { LayerHoverProviderLive } from "./LayerHoverProvider.ts"
import { launch, logger, VsCodeContext } from "./VsCode.ts"
import * as VscodeExtHost from "./VscodeExtHost.ts"
import { VscodeExtHostDebugger } from "./VscodeExtHostDebugger.ts"

const MainLive = Layer.mergeAll(
  ClientsLive,
  LayerHoverProviderLive,
  InjectNodeOptionsInstrumentationLive
).pipe(
  Layer.provideMerge(VscodeExtension),
  Layer.provide(VscodeExtHost.layer),
  Layer.provide(VscodeExtHostDebugger),
  Layer.provide(logger("Effect Dev Tools")),
  Layer.provideMerge(InitialContributes)
)

export function activate(context: vscode.ExtensionContext) {
  launch(MainLive).pipe(
    Effect.provideService(VsCodeContext, context),
    Effect.runFork
  )
}
