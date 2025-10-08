import * as Array from "effect/Array"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Schema from "effect/Schema"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import * as DebugChannel from "./DebugChannel"
import { compiledInstrumentationString } from "./instrumentation/instrumentation.compiled"
import { listenFork, VsCodeContext } from "./VsCode"

export class DebuggerThreadStopped extends Data.TaggedClass("DebuggerThreadStopped")<{
  threadId?: number
}> {}

export class DebuggerThreadContinued extends Data.TaggedClass("DebuggerThreadContinued")<{
  threadId: number
}> {}

export type DebuggerEvent = DebuggerThreadStopped | DebuggerThreadContinued

export interface DebugEnvImpl {
  readonly session: SubscriptionRef.SubscriptionRef<Option.Option<Session>>
  readonly events: PubSub.PubSub<DebuggerEvent>
}

export interface Session {
  readonly context: (threadId: number | undefined) => Effect.Effect<Array<ContextPair>>
  readonly currentSpanStack: (threadId: number | undefined) => Effect.Effect<Array<SpanStackEntry>>
  readonly currentFibers: (threadId: number | undefined) => Effect.Effect<Array<FiberEntry>>
  readonly currentAutoPauseConfig: (threadId: number | undefined) => Effect.Effect<{ pauseOnDefects: boolean }>
  readonly togglePauseOnDefects: (threadId: number | undefined) => Effect.Effect<void>
  readonly getAndUnsetPauseStateToReveal: (threadId: number | undefined) => Effect.Effect<PauseStateToReveal>
}

export class DebugEnv extends Context.Tag("effect-vscode/DebugEnv")<
  DebugEnv,
  DebugEnvImpl
>() {
  static readonly Live = Layer.scoped(
    DebugEnv,
    Effect.gen(function*() {
      const sessionRef = yield* SubscriptionRef.make(Option.none<Session>())
      const events = yield* PubSub.sliding<DebuggerEvent>(100)

      yield* listenFork(
        vscode.debug.onDidChangeActiveDebugSession,
        Effect.fn(function*(session) {
          if (!session) return yield* SubscriptionRef.set(sessionRef, Option.none())
          const debugChannel = yield* DebugChannel.makeVsCodeDebugSession(session)
          const withDebugChannel = Effect.provideService(DebugChannel.DebugChannel, debugChannel)

          // return session
          return yield* SubscriptionRef.set(
            sessionRef,
            Option.some({
              context: (threadId) => withDebugChannel(getContext(threadId)),
              currentSpanStack: (threadId) => withDebugChannel(getCurrentSpanStack(threadId)),
              currentFibers: (threadId) => withDebugChannel(getCurrentFibers(threadId)),
              currentAutoPauseConfig: (threadId) => withDebugChannel(getCurrentAutoPauseConfig(threadId)),
              togglePauseOnDefects: (threadId) => withDebugChannel(togglePauseOnDefects(threadId)),
              getAndUnsetPauseStateToReveal: (threadId) => withDebugChannel(getAndUnsetPauseStateToReveal(threadId))
            })
          )
        })
      )

      const context = yield* VsCodeContext
      context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
          createDebugAdapterTracker(_) {
            return {
              onDidSendMessage(message) {
                if (message.type === "event" && message.event === "stopped") {
                  events.unsafeOffer(
                    new DebuggerThreadStopped({ threadId: message.body?.threadId })
                  )
                } else if (message.type === "event" && message.event === "continued") {
                  events.unsafeOffer(
                    new DebuggerThreadContinued({
                      threadId: message.body?.threadId
                    })
                  )
                }
              }
            }
          }
        })
      )

      return { session: sessionRef, events }
    })
  )
}

// --

export const ensureInstrumentationInjected = (
  guessFrameId: boolean,
  threadId?: number
) =>
  Effect.gen(function*() {
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `(globalThis && "effect/devtools/instrumentation" in globalThis)`,
      guessFrameId,
      threadId
    })
    const isInjected = yield* result.parse(Schema.Boolean)
    if (!isInjected) {
      yield* DebugChannel.DebugChannel.evaluateOnEveryExecutionContext({
        expression: compiledInstrumentationString
      }).pipe(
        Effect.orElse(() =>
          DebugChannel.DebugChannel.evaluate({
            expression: compiledInstrumentationString,
            guessFrameId,
            threadId
          })
        )
      )
    }
  })

export class ContextPair extends Data.TaggedClass("ContextPair")<{
  readonly tag: string
  readonly service: DebugChannel.VariableReference
}> {}

const ContextSchema = Schema.Array(Schema.Tuple(Schema.String, DebugChannel.VariableReference.SchemaFromSelf))

const getContext = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression:
        `globalThis["effect/devtools/instrumentation"].getFiberCurrentContext(globalThis["effect/FiberCurrent"])`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(ContextSchema)
  }).pipe(
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => []),
    Effect.map(
      Array.map(
        ([tag, service]) => new ContextPair({ tag, service })
      )
    )
  )

// --

export class SpanStackEntry extends Data.Class<{
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly stackIndex: number
  readonly path?: string
  readonly line: number
  readonly column: number
  readonly attributes: ReadonlyArray<readonly [string, DebugChannel.VariableReference]>
}> {
}

const StackLocation = Schema.Struct({
  path: Schema.String,
  line: Schema.Int,
  column: Schema.Int
})
export type StackLocation = Schema.Schema.Type<typeof StackLocation>

const SpanSchema = Schema.Struct({
  _tag: Schema.Literal("Span"),
  spanId: Schema.String,
  traceId: Schema.String,
  name: Schema.String,
  stack: Schema.Array(StackLocation),
  attributes: Schema.Array(Schema.Tuple(Schema.String, DebugChannel.VariableReference.SchemaFromSelf))
})

const ExternalSpanSchema = Schema.Struct({
  _tag: Schema.Literal("ExternalSpan"),
  spanId: Schema.String,
  traceId: Schema.String
})

const AnySpanSchema = Schema.Union(SpanSchema, ExternalSpanSchema)
export type AnySpanSchema = Schema.Schema.Type<typeof AnySpanSchema>

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

const FiberCurrentSpanResponseSchema = Schema.Array(Schema.Union(SpanSchema, ExternalSpanSchema))

function getFiberCurrentSpan(currentFiberExpression: string, maxDepth: number, threadId: number | undefined) {
  return Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression:
        `globalThis["effect/devtools/instrumentation"].getFiberCurrentSpanStack(${currentFiberExpression}, ${maxDepth})`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(FiberCurrentSpanResponseSchema)
  }).pipe(
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

export const getCurrentSpanStack = (threadId: number | undefined) =>
  getFiberCurrentSpan(`globalThis["effect/FiberCurrent"]`, 0, threadId)

// --

export class FiberEntry extends Data.Class<{
  readonly id: string
  readonly stack: Array<SpanStackEntry>
  readonly isCurrent: boolean
  readonly isInterruptible: boolean
  readonly isInterrupted: boolean
  readonly children: ReadonlyArray<string>
  readonly startTimeMillis: number
  readonly lifeTimeMillis: number
  readonly interrupt: Effect.Effect<void>
}> {
}

const CurrentFiberSchema = Schema.Array(Schema.Struct({
  id: Schema.String,
  isCurrent: Schema.Boolean,
  isInterrupted: Schema.Boolean,
  isInterruptible: Schema.Boolean,
  children: Schema.Array(Schema.String),
  startTimeMillis: Schema.Number,
  lifeTimeMillis: Schema.Number
}))

const getCurrentFibers = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis["effect/devtools/instrumentation"].getAliveFibers()`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(CurrentFiberSchema)
  }).pipe(
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => []),
    Effect.flatMap((fibers) =>
      Effect.all(
        fibers.map((fiber, idx) =>
          Effect.flatMap(
            getFiberCurrentSpan(`(globalThis["effect/devtools/instrumentation"].fibers || [])[${idx}]`, 1, threadId),
            (stack) =>
              Effect.gen(function*() {
                const runtime = yield* Effect.runtime<DebugChannel.DebugChannel>()

                return new FiberEntry({
                  ...fiber,
                  stack,
                  interrupt: Effect.provide(
                    DebugChannel.DebugChannel.evaluate({
                      expression: `globalThis["effect/devtools/instrumentation"].interruptFiber(${
                        JSON.stringify(fiber.id)
                      })`,
                      guessFrameId: true,
                      threadId
                    }),
                    runtime
                  ).pipe(Effect.ignoreLogged)
                })
              })
          )
        ),
        { concurrency: "unbounded" }
      )
    )
  )

const AutoPauseConfigSchema = Schema.Struct({ pauseOnDefects: Schema.Boolean })
export type AutoPauseConfigSchema = Schema.Schema.Type<typeof AutoPauseConfigSchema>

const getCurrentAutoPauseConfig = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis["effect/devtools/instrumentation"].getAutoPauseConfig()`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(AutoPauseConfigSchema)
  }).pipe(
    Effect.orElseSucceed(() => ({ pauseOnDefects: false }))
  )

const togglePauseOnDefects = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis["effect/devtools/instrumentation"].togglePauseOnDefects()`,
      guessFrameId: true,
      threadId
    })
  }).pipe(
    Effect.ignoreLogged
  )

class PauseStateToReveal extends Schema.Class<PauseStateToReveal>("PauseStateToReveal")({
  location: Schema.Option(StackLocation),
  values: Schema.Array(Schema.Struct({
    label: Schema.String,
    value: DebugChannel.VariableReference.SchemaFromSelf
  }))
}) {
  static None = new PauseStateToReveal({ location: Option.none(), values: [] })
}

const getAndUnsetPauseStateToReveal = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis["effect/devtools/instrumentation"].getAndUnsetPauseStateToReveal()`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(PauseStateToReveal)
  }).pipe(
    Effect.orElseSucceed(() => PauseStateToReveal.None)
  )
