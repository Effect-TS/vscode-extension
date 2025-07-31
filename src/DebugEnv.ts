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

const contextExpression = `[...globalThis["effect/FiberCurrent"]?._fiberRefs.locals.values() ?? []]
    .map(_ => _[0][1])
    .filter(_ => typeof _ === "object" && _ !== null && Symbol.for("effect/Context") in _)
    .flatMap(context => [...context.unsafeMap.entries()]);`

const ContextSchema = Schema.Array(Schema.Tuple(Schema.String, DebugChannel.VariableReference.SchemaFromSelf))

const getContext = (threadId: number | undefined) =>
  Effect.gen(function*() {
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: contextExpression,
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

const StackLocation = Schema.NonEmptyString.pipe(Schema.compose(
  Schema.TemplateLiteralParser(
    Schema.NonEmptyString,
    Schema.Literal(" ("),
    Schema.NonEmptyString,
    Schema.Literal(":"),
    Schema.NumberFromString.pipe(Schema.compose(Schema.Int), Schema.positive()),
    Schema.Literal(":"),
    Schema.NumberFromString.pipe(Schema.compose(Schema.Int), Schema.positive()),
    Schema.Literal(")")
  ).pipe(
    Schema.transform(
      Schema.Struct({
        name: Schema.NonEmptyString,
        path: Schema.NonEmptyString,
        line: Schema.Int,
        column: Schema.Int
      }),
      {
        strict: true,
        decode: ([name, _, path, __, line, ___, column]) => ({ path, line: line - 1, column: column - 1, name }),
        encode: ({ column, line, name, path }) => [name, " (", path, ":", line + 1, ":", column + 1, ")"] as const
      }
    )
  )
))

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
  // NOTE: Keep this expression as backwards compatible as possible
  // so avoid const, let, arrow functions, etc.
  const currentSpanStackExpression = `(function(fiber){
  var spans = [];
  if(!fiber || !fiber.currentSpan) return spans;
  var globalStores = Object.keys(globalThis).filter(function(key){
    return key.indexOf("effect/GlobalValue/globalStoreId") > -1
  }).map(function(key){
    return globalThis[key];
  });
  var current = fiber.currentSpan;
  while(current) {
    var stackString = globalStores.reduce(function(acc, store){
      if(acc || !store) return acc;
      var spanToTrace = store.get("effect/Tracer/spanToTrace");
      var stackFn = spanToTrace ? spanToTrace.get(current) : acc;
      return stackFn ? stackFn() : acc;
    }, undefined) || "";
    var stack = stackString.split("\\n").filter(function(_){
      return _ !== ""
    })
    
    spans.push({
      _tag: current._tag,
      spanId: current.spanId,
      traceId: current.traceId,
      name: current.name,
      attributes: current.attributes ? Array.from(current.attributes.entries()) : [],
      stack: stack
    })
    current = current.parent && current.parent._tag === "Some" ? current.parent.value : null;
  }
  return spans;
})(${currentFiberExpression})`

  return Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: currentSpanStackExpression,
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
}> {
}

const currentFibersExpression = `(function(){
  var fibers = (globalThis["effect/devtools/instrumentation"].fibers || []).map(function(fiber){
    return {
      id: fiber.id().id.toString(),
      isCurrent: fiber === globalThis["effect/FiberCurrent"],
    }
  });
  return fibers;
})()`

const CurrentFiberSchema = Schema.Array(Schema.Struct({
  id: Schema.String,
  isCurrent: Schema.Boolean
}))

const getCurrentFibers = (threadId: number | undefined) =>
  Effect.gen(function*() {
    yield* ensureInstrumentationInjected(true, threadId)
    const result = yield* DebugChannel.DebugChannel.evaluate({
      expression: currentFibersExpression,
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
