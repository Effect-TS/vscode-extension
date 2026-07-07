import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as ExtHostDebugSession from "./ExtHostDebuggerConnection.ts"
import type { ReadableSubscribable } from "./utils.ts"

export class ExtHostDebugger extends Context.Tag("effect-vscode/core/ExtHostDebugger")<ExtHostDebugger, {
  readonly activeConnection: ReadableSubscribable<
    Option.Option<ExtHostDebugSession.ExtHostDebuggerConnection>
  >
  readonly connections: ReadableSubscribable<Array<ExtHostDebugSession.ExtHostDebuggerConnection>>
}>() {
  static readonly Mock = Layer.effect(
    this,
    Effect.gen(function*() {
      return {
        activeConnection: yield* SubscriptionRef.make(Option.none()),
        connections: yield* SubscriptionRef.make([])
      }
    })
  )
}
