import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Array from "effect/Array"
import * as Record from "effect/Record"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as vscode from "vscode"
import {
  VsCodeContext,
  VsCodeDebugSession,
  debugRequest,
  listenFork,
} from "./VsCode"

export interface DebugEnvImpl {
  readonly session: SubscriptionRef.SubscriptionRef<Option.Option<Session>>
  readonly messages: PubSub.PubSub<Message>
}

export interface Session {
  readonly vscode: vscode.DebugSession
  readonly context: Effect.Effect<Array<ContextPair>>
  readonly currentSpanStack: Effect.Effect<Array<SpanStackEntry>>
  readonly currentFibers: Effect.Effect<Array<FiberEntry>>
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
    Effect.gen(function* () {
      const sessionRef = yield* SubscriptionRef.make(Option.none<Session>())
      const messages = yield* PubSub.sliding<Message>(100)

      yield* listenFork(vscode.debug.onDidChangeActiveDebugSession, session =>
        SubscriptionRef.set(
          sessionRef,
          Option.map(Option.fromNullable(session), vscode => ({
            vscode,
            context: getContext.pipe(
              Effect.provideService(VsCodeDebugSession, vscode),
            ),
            currentSpanStack: getCurrentSpanStack.pipe(
              Effect.provideService(VsCodeDebugSession, vscode),
            ),
            currentFibers: getCurrentFibers.pipe(
              Effect.provideService(VsCodeDebugSession, vscode),
            ),
          })),
        ),
      )

      const context = yield* VsCodeContext
      context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory("*", {
          createDebugAdapterTracker(_) {
            return {
              onDidSendMessage(message) {
                messages.unsafeOffer(message)
              },
            }
          },
        }),
      )

      return { session: sessionRef, messages }
    }),
  )
}

// --

export class Variable extends Data.Class<{
  readonly name: string
  readonly value: string
  readonly type: string
  readonly variablesReference: number
}> {
  static request(variablesReference: number) {
    return debugRequest<{ readonly variables: Array<any> }>("variables", {
      variablesReference,
    }).pipe(Effect.map(_ => _.variables.map(_ => new Variable(_))))
  }

  readonly children = Effect.runSync(
    Effect.cached(Variable.request(this.variablesReference)),
  )
}

export class ContextPair extends Data.TaggedClass("ContextPair")<{
  readonly tag: string
  readonly service: Variable
}> {}

const contextExpression = `[...globalThis["effect/FiberCurrent"]?._fiberRefs.locals.values() ?? []]
    .map(_ => _[0][1])
    .filter(_ => typeof _ === "object" && _ !== null && Symbol.for("effect/Context") in _)
    .flatMap(context => [...context.unsafeMap.entries()]);`

const getContext = debugRequest<any>("evaluate", {
  expression: contextExpression,
}).pipe(
  Effect.flatMap(result => Variable.request(result.variablesReference)),
  // get tag/service pairs
  Effect.flatMap(tags =>
    Effect.forEach(tags.slice(0, -3), _ => _.children, {
      concurrency: "inherit",
    }),
  ),
  Effect.map(
    Array.map(
      ([tag, service]) =>
        new ContextPair({ tag: tag.value.replace(/'/g, ""), service }),
    ),
  ),
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
}> {
}

interface VariableReference {
  readonly name: string
  readonly value: string
  readonly type?: string
  readonly variablesReference: number
}

interface VariableParser<A> {
  (reference: VariableReference, path: string[]): Effect.Effect<A, string, VsCodeDebugSession>
}

const variableParserFailure = (path: string[], message: string) =>
  Effect.fail(`At ${path.join(".")} ${message}`)


const variableString: VariableParser<string> = (ref, path) => {
  if(ref && ref.type === "string"){
    if(ref.value.startsWith("'") && ref.value.endsWith("'")){
      return Effect.succeed(ref.value.slice(1, -1))
    }
    return Effect.succeed(ref.value)
  }
  return variableParserFailure(path, `expected string got ` + (JSON.stringify(ref)))
}
const variableBoolean: VariableParser<boolean> = (ref, path) => {
  if(ref && ref.type === "boolean"){
    if(ref.value === "true" || ref.value === "false"){
      return Effect.succeed(ref.value === "true")
    }
  }
  return variableParserFailure(path, `expected boolean got ` + (JSON.stringify(ref)))
}

const variableArray = <A>(item: VariableParser<A>): VariableParser<Array<A>> => (ref, path) => Effect.gen(function*(){
  if(!ref) return yield* variableParserFailure(path, "Missing array reference")
  const { variables } = yield* debugRequest<{ readonly variables: Array<VariableReference> }>("variables", {
    variablesReference: ref.variablesReference,
  })

  const lengthRef = variables.find(_ => _.name === "length")
  if(!lengthRef) return yield* variableParserFailure(path, "Missing length")
  const length = parseInt(lengthRef.value)
  if(length === 0) return []
  return yield* Effect.all(Array.makeBy(length, idx => item(variables.find(_ => _.name === idx.toString())!, path.concat([idx.toString()]))), { concurrency: "unbounded" })
})

const variableStruct = <S extends Record<string, VariableParser<any>>>(struct: S): VariableParser<{ [K in keyof S]: Effect.Effect.Success<ReturnType<S[K]>> }> => (ref, path) => Effect.gen(function*(){
  if(!ref) return yield* variableParserFailure(path, "Missing struct reference")
  const { variables } = yield* debugRequest<{ readonly variables: Array<VariableReference> }>("variables", {
    variablesReference: ref.variablesReference,
  })

  const final = Record.map(struct, (parser, key) => parser(variables.find(_ => _.name === key)!, path.concat([key])))
  return yield* Effect.all(final, { concurrency: "unbounded" }) as Effect.Effect<any, string, VsCodeDebugSession>
})

const spanParser = variableStruct({
  _tag: variableString,
  spanId: variableString,
  traceId: variableString,
  name: variableString,
  stack: variableArray(variableString),
})

const spanStackParser = variableArray(spanParser)

function getFiberCurrentSpan(currentFiberExpression: string){

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
    var stack = stackString.split("\\n")
    
    if(current._tag === "Span"){
      spans.push({
        _tag: "Span",
        spanId: current.spanId,
        traceId: current.traceId,
        name: current.name,
        stack: stack
      })
    } else if (current._tag === "External"){
      spans.push({
        _tag: "External",
        spanId: current.spanId,
        traceId: current.traceId,
        name: "<external span " + current.spanId + ">",
        stack: stack
      })
    }
    current = current.parent && current.parent._tag === "Some" ? current.parent.value : null;
  }
  return spans;
})(${currentFiberExpression})`


const locationRegex = /\((.*):([0-9]+):([0-9]+)\)$/gm
return debugRequest<any>("evaluate", {
  expression: currentSpanStackExpression,
}).pipe(
  Effect.flatMap(_ => spanStackParser(_, [])),
  Effect.catchAll((e) => Effect.succeed([])),
  Effect.map(stack => {
    // now, a single span can have a stack with multiple locations
    // so we need to duplicate the span for each location
    const spans: Array<SpanStackEntry> = []
    const stackEntries = stack
    while(stackEntries.length > 0){
      const entry = stackEntries.shift()!
      let match = false
      for(let stackIndex = 0; stackIndex < entry.stack.length; stackIndex++){
        const stackLine = entry.stack[stackIndex]!
        const locationMatchAll = stackLine.matchAll(locationRegex)
        for (const [, path, line, column] of locationMatchAll) {
          match = true
          spans.push(new SpanStackEntry({
            ...entry,
            stackIndex,
            path,
            line: parseInt(line, 10) - 1, // vscode uses 0-based line numbers
            column: parseInt(column, 10) - 1,
          }))
        }
      }
      if(!match){
        spans.push(new SpanStackEntry({...entry, stackIndex: -1, line: 0, column: 0}))
      }
    }

    return spans
  })
)
}

export const getCurrentSpanStack = getFiberCurrentSpan(`globalThis["effect/FiberCurrent"]`)

// --

export class FiberEntry extends Data.Class<{
  readonly id: string
  readonly stack: Array<SpanStackEntry>
  readonly isCurrent: boolean
}> {
}

const currentFibersExpression = `(function(){
  // do not double inject
  if(!("effect/debugger/currentFibers" in globalThis)){
    // create a global array to store the current fibers
    globalThis["effect/debugger/currentFibers"] = [];

    // replace the effect/FiberCurrent with a getter/setter so we can detect fibers
    // starting for the first time
    var _previousFiber = globalThis["effect/FiberCurrent"];
    var _currentFiber = undefined;
    Object.defineProperty(globalThis, "effect/FiberCurrent", {
      get: function() {
        return _currentFiber;
      },
      set: function(value) {
        if(value && "addObserver" in value && globalThis["effect/debugger/currentFibers"].indexOf(value) === -1){
          globalThis["effect/debugger/currentFibers"].push(value);
          value.addObserver(function(){
            var index = globalThis["effect/debugger/currentFibers"].indexOf(value);
            if(index > -1){
              globalThis["effect/debugger/currentFibers"].splice(index, 1);
            }
          });
        }
        _currentFiber = value;
      }
    });
    // so we ensure we trigger the setter
    globalThis["effect/FiberCurrent"] = _previousFiber;
  }

  var fibers = globalThis["effect/debugger/currentFibers"].map(function(fiber){
    return {
      id: fiber.id().id.toString(),
      isCurrent: fiber === globalThis["effect/FiberCurrent"],
    }
  });
  return fibers;
})()`

const currentFibersParser = variableArray(variableStruct({
  id: variableString,
  isCurrent: variableBoolean
}))

const getCurrentFibers = debugRequest<any>("evaluate", {
  expression: currentFibersExpression,
}).pipe(
  Effect.flatMap(_ => currentFibersParser(_, [])),
  Effect.catchAll((e) => Effect.succeed([])),
  Effect.flatMap(fibers => Effect.all(fibers.map((fiber, idx) => Effect.map(getFiberCurrentSpan(`globalThis["effect/debugger/currentFibers"][${idx}]`), stack => new FiberEntry({...fiber, stack})), { concurrency: "unbounded" }) )),
  Effect.map(_ => {
    console.log("Current fibers:", _)
    return _
  })
)