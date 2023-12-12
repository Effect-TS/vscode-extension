import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  ReadonlyArray,
  SubscriptionRef,
} from "effect"
import { VsCodeDebugSession, debugRequest, debugSessionHandler } from "./VsCode"
import * as vscode from "vscode"

export interface DebugEnv {
  readonly _: unique symbol
}
export interface DebugContext {
  readonly session: SubscriptionRef.SubscriptionRef<Option.Option<Session>>
}
export const DebugEnv = Context.Tag<DebugEnv, DebugContext>(
  "effect-vscode/DebugEnv",
)
const DebugContextLive = Layer.effect(
  DebugEnv,
  Effect.gen(function* (_) {
    const session = yield* _(SubscriptionRef.make(Option.none<Session>()))
    return { session }
  }),
)

export interface Session {
  readonly vscode: vscode.DebugSession
  readonly context: Effect.Effect<never, never, Array<ContextPair>>
}

export const DebugEnvLive = debugSessionHandler(
  Effect.gen(function* (_) {
    const vscodeSession = yield* _(VsCodeDebugSession)
    const context = getContext.pipe(
      Effect.provideService(VsCodeDebugSession, vscodeSession),
    )
    const session: Session = { vscode: vscodeSession, context }
    const debug = yield* _(DebugEnv)
    yield* _(
      Effect.acquireRelease(
        SubscriptionRef.set(debug.session, Option.some(session)),
        () => SubscriptionRef.set(debug.session, Option.none()),
      ),
    )
  }),
).pipe(Layer.provideMerge(DebugContextLive))

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
    .flatMap(context => [...context.unsafeMap.entries()])
    .map(([tag, service]) => [tag.identifier ? String(tag.identifier) : "Unknown Tag", service])`

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
    ReadonlyArray.map(
      ([tag, service]) =>
        new ContextPair({ tag: tag.value.replace(/'/g, ""), service }),
    ),
  ),
)
