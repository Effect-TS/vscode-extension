import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as vscode from "vscode"
import type { InfoNode } from "./SpanProvider"
import { registerCommand } from "./VsCode"

export const TreeCommandsLive = Effect.gen(function*() {
  yield* registerCommand(
    "effect.copyInfoValue",
    (infoNode: InfoNode) => Effect.promise(() => vscode.env.clipboard.writeText(infoNode.description))
  )
}).pipe(Layer.effectDiscard)
