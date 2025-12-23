import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export class ExtTextEditorHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtTextEditor/ExtTextEditorHostCapability")<
    ExtTextEditorHostCapability,
    {
      revealFileLineColumnRange(
        path: string,
        line: number,
        column: number,
        endLine: number,
        endColumn: number
      ): Effect.Effect<void, never, never>
    }
  >()
{}

export const layerNoop = Layer.succeed(ExtTextEditorHostCapability, {
  revealFileLineColumnRange: () => Effect.void
})
