/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Mailbox from "effect/Mailbox"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import * as ExtWhenClause from "./ExtWhenClause.ts"

export interface ExtWebViewBuilder<RX = never> {
  (
    request: (_: unknown) => Effect.Effect<void>,
    queue: Mailbox.ReadonlyMailbox<unknown>
  ): Effect.Effect<void, never, RX>
}

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtWebView")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtWebView = (u: unknown): u is ExtWebView<any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool tree view that can be displayed in a devtool application.
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtWebView<
  in out Id extends string,
  in out Type extends string,
  in out R = never
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _id: Id
  readonly type: Type
  readonly title: string
  readonly key: string
  readonly when: ExtWhenClause.ExtWhenClause<boolean, R>

  /**
   * Converts the tree view into a Layer containing the provider.
   */
  toLayer<RX = never>(
    build: ExtWebViewBuilder<RX>
  ): Layer.Layer<
    UnknownWebView<Id>,
    never,
    Exclude<RX, Scope.Scope> | R | ExtWebViewHostCapability
  >
}

export interface UnknownWebView<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
}

export interface UnknownWebViewType<_Type extends string> {
  readonly _: unique symbol
  readonly type: _Type
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Any extends Pipeable {
  readonly [TypeId]: TypeId
  readonly _id: string
  readonly key: string
}

/**
 * @since 1.0.0
 * @category models
 */
export interface AnyWithProps {
  readonly [TypeId]: TypeId
  readonly _id: string
  readonly type: string
  readonly title: string
  readonly key: string
  readonly when: ExtWhenClause.AnyBoolean
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends ExtWebView<infer _Id, infer _R> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends ExtWebView<infer _Id, infer _R> ? _R
  : never

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  toLayer(
    this: AnyWithProps,
    build: ExtWebViewBuilder<any>
  ) {
    return Layer.effectDiscard(Effect.gen(this, function*() {
      const host = yield* ExtWebViewHostCapability
      const context = yield* Effect.context<any>()
      yield* host.registerWebView(this, (...args) => build(...args).pipe(Effect.provide(context)))
    }))
  }
}

const makeProto = <
  const Id extends string,
  const Type extends string,
  When extends ExtWhenClause.AnyBoolean
>(options: {
  readonly _id: Id
  readonly type: Type
  readonly title: string
  readonly when: When
}): ExtWebView<Id, Type, When> => {
  function ExtWebView() {}
  Object.setPrototypeOf(ExtWebView, Proto)
  Object.assign(ExtWebView, options)
  ExtWebView.key = `@effect/devtools/ExtWebView/${options._id}`
  return ExtWebView as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <
  const Id extends string,
  const Type extends string,
  When extends ExtWhenClause.AnyBoolean = never
>(
  id: Id,
  options: {
    readonly title: string
    readonly type: Type
    readonly when?: When
  }
): ExtWebView<Id, Type, ExtWhenClause.Context<When>> => {
  const when = options?.when ?? ExtWhenClause.trueLiteral

  return makeProto({
    _id: id,
    when,
    title: options.title,
    type: options.type
  }) as any
}

export class ExtWebViewHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtWebView/ExtWebViewHostCapability")<ExtWebViewHostCapability, {
    registerWebView(
      webView: AnyWithProps,
      builder: ExtWebViewBuilder<Scope.Scope>
    ): Effect.Effect<void, never, never>
  }>()
{}
