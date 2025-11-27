import * as Array from "effect/Array"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as ExtHostDebugger from "./core/ExtHostDebugger.ts"
import * as ExtHostDebuggerConnection from "./core/ExtHostDebuggerConnection.ts"
import { compiledInstrumentationString } from "./DevtoolDebugBridgeString.generated.ts"

export interface Bridge {
  readonly events: PubSub.PubSub<ExtHostDebuggerConnection.DebuggerEvent>
  readonly context: (threadId: number | undefined) => Effect.Effect<Array<ContextPair>, never, Scope.Scope>
  readonly currentSpanStack: (threadId: number | undefined) => Effect.Effect<Array<SpanStackEntry>, never, Scope.Scope>
  readonly currentFibers: (threadId: number | undefined) => Effect.Effect<ReadonlyArray<FiberEntry>, never, Scope.Scope>
  readonly currentAutoPauseConfig: (
    threadId: number | undefined
  ) => Effect.Effect<{ pauseOnDefects: boolean }>
  readonly togglePauseOnDefects: (threadId: number | undefined) => Effect.Effect<void>
  readonly getAndUnsetPauseStateToReveal: (
    threadId: number | undefined
  ) => Effect.Effect<PauseStateToReveal, never, Scope.Scope>
  readonly interruptFiber: (fiberId: string, threadId: number | undefined) => Effect.Effect<void>
}

export class DevtoolDebugBridge extends Effect.Service<DevtoolDebugBridge>()("effect-vscode/DevtoolDebugBridge", {
  scoped: Effect.gen(function*() {
    const activeBridge = yield* SubscriptionRef.make(Option.none<Bridge>())
    const hostDebugger = yield* ExtHostDebugger.ExtHostDebugger

    yield* hostDebugger.activeConnection.changes.pipe(
      Stream.mapEffect(Option.match({
        onNone: () => SubscriptionRef.set(activeBridge, Option.none()),
        onSome: (debugConnection) =>
          SubscriptionRef.set(
            activeBridge,
            Option.some({
              events: debugConnection.events,
              context: (threadId) => getContext(debugConnection, threadId),
              currentSpanStack: (threadId) => getCurrentSpanStack(debugConnection, threadId),
              currentFibers: (threadId) => getCurrentFibers(debugConnection, threadId),
              currentAutoPauseConfig: (threadId) => getCurrentAutoPauseConfig(debugConnection, threadId),
              togglePauseOnDefects: (threadId) => togglePauseOnDefects(debugConnection, threadId),
              getAndUnsetPauseStateToReveal: (threadId) => getAndUnsetPauseStateToReveal(debugConnection, threadId),
              interruptFiber: (fiberId, threadId) => interruptFiber(debugConnection, fiberId, threadId)
            })
          )
      })),
      Stream.runDrain,
      Effect.forkScoped
    )

    return { activeBridge }
  })
}) {}

export class ContextPair extends Data.TaggedClass("ContextPair")<{
  readonly tag: string
  readonly service: ExtHostDebuggerConnection.VariableReference
}> {}

export const ContextSchema = Schema.Array(
  Schema.Tuple(Schema.String, ExtHostDebuggerConnection.VariableReference.Schema)
)

export class SpanStackEntry extends Data.Class<{
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly stackIndex: number
  readonly path?: string
  readonly line: number
  readonly column: number
  readonly attributes: ReadonlyArray<readonly [string, ExtHostDebuggerConnection.VariableReference]>
}> {
}

const StackLocation = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int
})
export type StackLocation = Schema.Schema.Type<typeof StackLocation>

const SpanAttributesSchema = Schema.Array(
  Schema.Tuple(Schema.String, ExtHostDebuggerConnection.VariableReference.Schema)
)

const SpanSchema = Schema.Struct({
  _tag: Schema.Literal("Span"),
  spanId: Schema.String,
  traceId: Schema.String,
  name: Schema.String,
  stack: Schema.Array(StackLocation),
  attributes: SpanAttributesSchema
})

const ExternalSpanSchema = Schema.Struct({
  _tag: Schema.Literal("ExternalSpan"),
  spanId: Schema.String,
  traceId: Schema.String
})

const AnySpanSchema = Schema.Union(SpanSchema, ExternalSpanSchema)
export type AnySpanSchema = Schema.Schema.Type<typeof AnySpanSchema>

export const FiberCurrentSpanResponseSchema = Schema.Array(Schema.Union(SpanSchema, ExternalSpanSchema))

export class FiberEntry extends Schema.TaggedClass<FiberEntry>("FiberEntry")("FiberEntry", {
  id: Schema.String,
  isCurrent: Schema.Boolean,
  isInterruptible: Schema.Boolean,
  isInterrupted: Schema.Boolean,
  children: Schema.Array(Schema.String),
  startTimeMillis: Schema.Number,
  lifeTimeMillis: Schema.Number,
  currentSpan: Schema.Option(AnySpanSchema)
}) {}

export const CurrentFiberSchema = Schema.Array(Schema.Struct({
  id: Schema.String,
  isCurrent: Schema.Boolean,
  isInterrupted: Schema.Boolean,
  isInterruptible: Schema.Boolean,
  children: Schema.Array(Schema.String),
  startTimeMillis: Schema.Number,
  lifeTimeMillis: Schema.Number
}))

export const AutoPauseConfigSchema = Schema.Struct({ pauseOnDefects: Schema.Boolean })
export type AutoPauseConfigSchema = Schema.Schema.Type<typeof AutoPauseConfigSchema>

export class PauseStateToReveal extends Schema.Class<PauseStateToReveal>("PauseStateToReveal")({
  location: Schema.Option(StackLocation),
  values: Schema.Array(Schema.Struct({
    label: Schema.String,
    value: ExtHostDebuggerConnection.VariableReference.Schema
  }))
}) {
  static None = new PauseStateToReveal({ location: Option.none(), values: [] })
}

// --
export const evaluateEnsuringInstrumentationInjected = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  expression: string,
  guessFrameId: boolean,
  threadId?: number
) =>
  connection.evaluate({
    expression:
      `(globalThis && "effect/devtools/instrumentation" in globalThis ? (function(){ return (${expression}) })() : "NO_EFFECT_INSTRUMENTATION")`,
    guessFrameId,
    threadId
  }).pipe(
    Effect.flatMap((result) =>
      (result.value || "").indexOf("NO_EFFECT_INSTRUMENTATION") !== -1 ?
        connection.evaluate({
          expression: compiledInstrumentationString,
          guessFrameId,
          threadId
        }).pipe(
          Effect.flatMap(() =>
            connection.evaluate({
              expression,
              guessFrameId,
              threadId
            })
          )
        ) :
        Effect.succeed(result)
    )
  )

const getContext = (connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection, threadId: number | undefined) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].getFiberCurrentContext(globalThis["effect/FiberCurrent"])`,
    true,
    threadId
  ).pipe(
    Effect.flatMap((result) => result.parse(ContextSchema)),
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => []),
    Effect.map(
      Array.map(
        ([tag, service]) => new ContextPair({ tag, service })
      )
    )
  )

// --

function spanEntryToSpanStackEntry(entry: AnySpanSchema | undefined): Array<SpanStackEntry> {
  const spans: Array<SpanStackEntry> = []
  if (!entry) return []
  switch (entry._tag) {
    case "Span": {
      let match = false
      for (let stackIndex = 0; stackIndex < entry.stack.length; stackIndex++) {
        const stackLine = entry.stack[stackIndex]!
        match = true
        spans.push(
          new SpanStackEntry({
            ...stackLine,
            ...entry,
            stackIndex
          })
        )
      }

      if (!match) {
        spans.push(new SpanStackEntry({ ...entry, stackIndex: -1, line: 0, column: 0 }))
      }
      break
    }
    case "ExternalSpan": {
      spans.push(
        new SpanStackEntry({
          ...entry,
          name: "<external span " + entry.spanId + ">",
          stackIndex: -1,
          line: 0,
          column: 0,
          attributes: []
        })
      )
      break
    }
  }
  return spans
}

function getFiberCurrentSpan(
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  currentFiberExpression: string,
  maxDepth: number,
  threadId: number | undefined
) {
  return evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].getFiberCurrentSpanStack(${currentFiberExpression}, ${maxDepth})`,
    true,
    threadId
  ).pipe(
    Effect.flatMap((result) => result.parse(FiberCurrentSpanResponseSchema)),
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => []),
    Effect.map((stack) => {
      // now, a single span can have a stack with multiple locations
      // so we need to duplicate the span for each location
      let spans: Array<SpanStackEntry> = []
      for (const entry of stack) {
        spans = [...spans, ...spanEntryToSpanStackEntry(entry)]
      }
      return spans
    })
  )
}

export const getCurrentSpanStack = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  threadId: number | undefined
) => getFiberCurrentSpan(connection, `globalThis["effect/FiberCurrent"]`, 0, threadId)

// --

const getCurrentFibers = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  threadId: number | undefined
) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].getAliveFibers()`,
    true,
    threadId
  ).pipe(
    Effect.flatMap((result) => result.parse(Schema.Array(FiberEntry))),
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => [])
  )

const getCurrentAutoPauseConfig = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  threadId: number | undefined
) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].getAutoPauseConfig()`,
    true,
    threadId
  ).pipe(
    Effect.flatMap((result) => result.parse(AutoPauseConfigSchema)),
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => ({ pauseOnDefects: false })),
    Effect.scoped
  )

const togglePauseOnDefects = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  threadId: number | undefined
) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].togglePauseOnDefects()`,
    true,
    threadId
  ).pipe(
    Effect.ignoreLogged,
    Effect.scoped
  )

const getAndUnsetPauseStateToReveal = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  threadId: number | undefined
) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].getAndUnsetPauseStateToReveal()`,
    true,
    threadId
  )
    .pipe(
      Effect.flatMap((result) => result.parse(PauseStateToReveal)),
      Effect.tapError(Effect.logError),
      Effect.orElseSucceed(() => PauseStateToReveal.None)
    )

const interruptFiber = (
  connection: ExtHostDebuggerConnection.ExtHostDebuggerConnection,
  fiberId: string,
  threadId: number | undefined
) =>
  evaluateEnsuringInstrumentationInjected(
    connection,
    `globalThis["effect/devtools/instrumentation"].interruptFiber(${JSON.stringify(fiberId)})`,
    true,
    threadId
  )
    .pipe(
      Effect.scoped,
      Effect.tapError(Effect.logError),
      Effect.orElseSucceed(() => Effect.void)
    )
