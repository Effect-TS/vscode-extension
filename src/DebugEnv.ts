import {
  Context,
  Data,
  Effect,
  Layer,
  Option,
  PubSub,
  ReadonlyArray,
  SubscriptionRef,
} from "effect"
import * as vscode from "vscode"
import {
  VsCodeContext,
  VsCodeDebugSession,
  debugRequest,
  listenFork,
} from "./VsCode"

export interface DebugEnv {
  readonly _: unique symbol
}
export interface DebugEnvImpl {
  readonly session: SubscriptionRef.SubscriptionRef<Option.Option<Session>>
  readonly messages: PubSub.PubSub<Message>
}
export const DebugEnv = Context.Tag<DebugEnv, DebugEnvImpl>(
  "effect-vscode/DebugEnv",
)

export interface Session {
  readonly vscode: vscode.DebugSession
  readonly context: Effect.Effect<never, never, Array<ContextPair>>
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

export const DebugEnvLive = Layer.scoped(
  DebugEnv,
  Effect.gen(function* (_) {
    const sessionRef = yield* _(SubscriptionRef.make(Option.none<Session>()))
    const messages = yield* _(PubSub.sliding<Message>(100))

    yield* _(
      listenFork(vscode.debug.onDidChangeActiveDebugSession, session =>
        SubscriptionRef.set(
          sessionRef,
          Option.map(Option.fromNullable(session), vscode => ({
            vscode,
            context: getContext.pipe(
              Effect.provideService(VsCodeDebugSession, vscode),
            ),
          })),
        ),
      ),
    )

    const context = yield* _(VsCodeContext)
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
