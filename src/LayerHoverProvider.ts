import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { executeCommandCatch, isExtensionInstalled, registerTextEditorCommand, revealCode } from "./VsCode"

export const LayerHoverProviderLive = Effect.gen(function*() {
  yield* registerTextEditorCommand("effect.showLayerMermaid", (textEditor) =>
    Effect.gen(function*() {
      // current range
      const position = textEditor.selection.active
      const document = textEditor.document

      // ask the LSP
      const result = yield* executeCommandCatch<any>("typescript.tsserverRequest", "_effectGetLayerMermaid", {
        path: document.uri.scheme === "file"
          ? document.uri.fsPath
          : document.uri.toString(),
        line: position.line,
        character: position.character
      }, { isAsync: true, lowPriority: true })

      // if success, launch the preview command
      if (result.success && result.body && result.body.success) {
        const mermaidCode = "%% Install the mermaid chart extension to see the preview\n" +
          String(result.body.mermaidCode)
        yield* revealCode(mermaidCode, "mermaid")
        if (yield* isExtensionInstalled("MermaidChart.vscode-mermaid-chart")) {
          yield* executeCommandCatch("mermaidChart.preview", mermaidCode)
        }
      }
    }))
}).pipe(Layer.scopedDiscard)
