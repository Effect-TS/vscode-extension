import * as Context_ from "effect/Context"
import type * as Effect from "effect/Effect"

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
