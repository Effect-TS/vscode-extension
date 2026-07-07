import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import type * as ParseResult from "effect/ParseResult"
import type * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"

export class DebuggerThreadStopped extends Data.TaggedClass("DebuggerThreadStopped")<{
  threadId?: number
}> {}

export class DebuggerThreadContinued extends Data.TaggedClass("DebuggerThreadContinued")<{
  threadId: number
}> {}

export type DebuggerEvent = DebuggerThreadStopped | DebuggerThreadContinued

export class DebugConnectionError extends Data.TaggedError("DebugConnectionError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class VariableReferenceConstructor
  extends Context.Tag("@effect/devtools-shared/core/ExtHostDebuggerConnection/VariableReferenceConstructor")<
    VariableReferenceConstructor,
    {
      readonly make: (metadata: any) => VariableReference
    }
  >()
{
}

export class VariableReference extends Data.TaggedClass("VariableReference")<{
  readonly name?: string
  readonly value?: string
  readonly isContainer: boolean
  readonly children: Effect.Effect<Array<VariableReference>, DebugConnectionError, never>
  readonly parse: <A, I>(
    schema: Schema.Schema<A, I, VariableReferenceConstructor>
  ) => Effect.Effect<A, DebugConnectionError | ParseResult.ParseError, never>
}> {
  static Schema = Schema.Unknown.pipe(
    Schema.annotations({ identifier: "VariableReference" }),
    Schema.transformOrFail(Schema.declare((_) => _ instanceof VariableReference, { identifier: "VariableReference" }), {
      decode: (_) => Effect.map(VariableReferenceConstructor, (r) => r.make(_)),
      encode: (_) => Effect.succeed(_),
      strict: true
    })
  )
}

export interface ExtHostDebuggerConnection {
  name: string
  events: PubSub.PubSub<DebuggerEvent>
  evaluate: (
    opts: {
      expression: string
      guessFrameId: boolean
      threadId: number | undefined
    }
  ) => Effect.Effect<VariableReference, DebugConnectionError, Scope.Scope>
}
