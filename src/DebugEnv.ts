import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Array from "effect/Array"
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
