import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { registerCommand } from "./VsCode"
import { InfoNode } from "./SpanProvider"
import * as vscode from "vscode"

export const TreeCommandsLive = Effect.gen(function* () {
  yield* registerCommand("effect.copyInfoValue", (infoNode: InfoNode) =>
    Effect.promise(() => vscode.env.clipboard.writeText(infoNode.description)),
  )
}).pipe(Layer.effectDiscard)
