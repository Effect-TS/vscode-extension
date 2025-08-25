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

export interface DebugEnvImpl {
  readonly session: SubscriptionRef.SubscriptionRef<Option.Option<Session>>
  readonly messages: PubSub.PubSub<Message>
}

export interface Session {
  readonly vscode: vscode.DebugSession
  readonly context: (threadId: number | undefined) => Effect.Effect<Array<ContextPair>>
  readonly currentSpanStack: (threadId: number | undefined) => Effect.Effect<Array<SpanStackEntry>>
  readonly currentFibers: (threadId: number | undefined) => Effect.Effect<Array<FiberEntry>>
}

export type Message =
  | {
    readonly seq: number
    readonly type: "event"
    readonly event: string
    readonly body?: any
  }
  | {
    readonly seq: number
    readonly type: "response"
    readonly command: string
    readonly success: boolean
    readonly body?: any
    readonly request_seq: number
    readonly message?: string
  }

export class DebugEnv extends Context.Tag("effect-vscode/DebugEnv")<
  DebugEnv,
  DebugEnvImpl
>() {
  static readonly Live = Layer.scoped(
    DebugEnv,
    Effect.gen(function*() {
      const sessionRef = yield* SubscriptionRef.make(Option.none<Session>())
      const messages = yield* PubSub.sliding<Message>(100)

      yield* listenFork(
        vscode.debug.onDidChangeActiveDebugSession,
        Effect.fn(function*(session) {
          if (!session) return yield* SubscriptionRef.set(sessionRef, Option.none())
          const debugChannel = yield* DebugChannel.makeVsCodeDebugSession(session)

          // return session
          return yield* SubscriptionRef.set(
            sessionRef,
            Option.some({
              vscode: session,
              context: (threadId) =>
                getContext(threadId).pipe(
                  Effect.provideService(DebugChannel.DebugChannel, debugChannel)
                ),
              currentSpanStack: (threadId) =>
                getCurrentSpanStack(threadId).pipe(
                  Effect.provideService(DebugChannel.DebugChannel, debugChannel)
                ),
              currentFibers: (threadId) =>
                getCurrentFibers(threadId).pipe(
                  Effect.provideService(DebugChannel.DebugChannel, debugChannel)
                )
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
                messages.unsafeOffer(message)
              }
            }
          }
        })
      )

      return { session: sessionRef, messages }
    })
  )
}

// --

export const ensureInstrumentationInjected = (guessFrameId: boolean, threadId?: number) =>
  Effect.gen(function*() {
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis && "effect/devtools/instrumentation" in globalThis`,
      guessFrameId,
      threadId
    })
    const isInjected = yield* result.parse(Schema.Boolean)
    if (!isInjected) {
      yield* DebugChannel.DebugChannel.evaluate({ expression: compiledInstrumentationString, guessFrameId, threadId })
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

const SpanSchema = Schema.Struct({
  _tag: Schema.Literal("Span"),
  spanId: Schema.String,
  traceId: Schema.String,
  name: Schema.String,
  stack: Schema.Array(StackLocation),
  attributes: Schema.Array(Schema.Tuple(Schema.String, DebugChannel.VariableReference.SchemaFromSelf))
})

const ExternalSpanSchema = Schema.Struct({
  _tag: Schema.Literal("External"),
  spanId: Schema.String,
  traceId: Schema.String
})

const SpanStackSchema = Schema.Array(Schema.Union(SpanSchema, ExternalSpanSchema))

function getFiberCurrentSpan(currentFiberExpression: string, threadId: number | undefined) {
  return Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: `globalThis["effect/devtools/instrumentation"].getFiberCurrentSpanStack(${currentFiberExpression})`,
      guessFrameId: true,
      threadId
    })
    return yield* result.parse(SpanStackSchema)
  }).pipe(
    Effect.tapError(Effect.logError),
    Effect.orElseSucceed(() => []),
    Effect.map((stack) => {
      // now, a single span can have a stack with multiple locations
      // so we need to duplicate the span for each location
      const spans: Array<SpanStackEntry> = []
      const stackEntries = [...stack]
      while (stackEntries.length > 0) {
        const entry = stackEntries.shift()!
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
          case "External": {
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
      }

      return spans
    })
  )
}

export const getCurrentSpanStack = (threadId: number | undefined) =>
  getFiberCurrentSpan(`globalThis["effect/FiberCurrent"]`, threadId)

// --

export class FiberEntry extends Data.Class<{
  readonly id: string
  readonly stack: Array<SpanStackEntry>
  readonly isCurrent: boolean
  readonly isInterruptible: boolean
}> {
}

const CurrentFiberSchema = Schema.Array(Schema.Struct({
  id: Schema.String,
  isCurrent: Schema.Boolean,
  isInterruptible: Schema.Boolean
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
          Effect.map(
            getFiberCurrentSpan(`(globalThis["effect/devtools/instrumentation"].fibers || [])[${idx}]`, threadId),
            (stack) => new FiberEntry({ ...fiber, stack })
          ), { concurrency: "unbounded" })
      )
    )
  )
