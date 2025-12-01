/**
 * @since 1.0.0
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Scope from "effect/Scope"
import type * as ExtCommand from "./ExtCommand.ts"
import * as ExtHost from "./ExtHost.ts"
import type * as ExtIcon from "./ExtIcon.ts"
import * as ExtWhenClause from "./ExtWhenClause.ts"

export type Keys<V extends AnyWithProps, C extends ExtCommand.AnyWithProps> = Item<V> extends { _tag: infer K } ?
  (K extends infer X ? (Extract<Item<V>, { _tag: X }> extends ExtCommand.PayloadEncoded<C> ? X
      : never) :
    never)
  : never

export interface ExtTreeViewItem {
  readonly id: string
  readonly label: string
  readonly description?: string | undefined
  readonly icon?: ExtIcon.ExtIcon | undefined
  readonly collapsibleState: "none" | "collapsed" | "expanded"
  readonly command?: ExtCommand.CommandWithArgs<ExtCommand.AnyWithProps>
}

export interface ExtTreeViewRefresh<Item> {
  (parent: Option.Option<Array<Item>>): Effect.Effect<void>
}

export interface ExtTreeViewBuilder<Item, R> {
  (
    refresh: ExtTreeViewRefresh<Item>
  ): Effect.Effect<ExtTreeViewDataProvider<Item>, never, R>
}

export interface ExtTreeViewDataProvider<Item> {
  treeItem: (element: Item) => Effect.Effect<ExtTreeViewItem>
  children: (
    parent: Option.Option<Item>
  ) => Effect.Effect<Option.Option<Array<Item>>>
}

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtTreeView")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtTreeView = (u: unknown): u is ExtTreeView<any, any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool tree view that can be displayed in a devtool application.
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtTreeView<
  in out Id extends string,
  in out Item extends { readonly _tag: string },
  in out R = never
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly ItemType: Item
  readonly _id: Id
  readonly title: string
  readonly key: string
  readonly when: ExtWhenClause.ExtWhenClause<boolean, R>

  /**
   * Converts the tree view into a Layer containing the provider.
   */
  toLayer<RX = never>(
    build: ExtTreeViewBuilder<Item, RX>
  ): Layer.Layer<
    ExtTreeViewProvider<Id> | UnknownTreeView<Id>,
    never,
    Exclude<RX, Scope.Scope> | R | ExtHost.ExtHost
  >
}

export interface UnknownTreeView<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
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
  readonly title: string
  readonly key: string
  readonly when: ExtWhenClause.AnyBoolean
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends ExtTreeView<infer _Id, infer _Item, infer _R> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Item<R> = R extends ExtTreeView<infer _Id, infer _Item, infer _R> ? _Item
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends ExtTreeView<infer _Id, infer _Item, infer _R> ? _R
  : never

/**
 * Provider interface for tree view data
 *
 * @since 1.0.0
 * @category models
 */
export interface ExtTreeViewProvider<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
  readonly builder: ExtTreeViewBuilder<any, never>
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  toLayer(
    this: AnyWithProps,
    build: ExtTreeViewBuilder<any, any>
  ) {
    return Layer.effectDiscard(Effect.gen(this, function*() {
      const host = yield* ExtHost.ExtHost
      const context = yield* Effect.context<any>()
      yield* host.registerTreeView(this, (refresh) => build(refresh).pipe(Effect.provide(context)))
    }))
  }
}

const makeProto = <
  const Id extends string,
  Item extends { readonly _tag: string },
  When extends ExtWhenClause.AnyBoolean
>(options: {
  readonly _id: Id
  readonly title: string
  readonly when: When
}): ExtTreeView<Id, Item, When> => {
  function ExtTreeView() {}
  Object.setPrototypeOf(ExtTreeView, Proto)
  Object.assign(ExtTreeView, options)
  ExtTreeView.key = `@effect/devtools/ExtTreeView/${options._id}`
  return ExtTreeView as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <Item extends { readonly _tag: string }>() =>
<
  const Id extends string,
  When extends ExtWhenClause.AnyBoolean = never
>(
  id: Id,
  options: {
    readonly title: string
    readonly when?: When
  }
): ExtTreeView<Id, Item, ExtWhenClause.Context<When>> => {
  const when = options?.when ?? ExtWhenClause.trueLiteral

  return makeProto({
    _id: id,
    when,
    title: options.title
  }) as any
}

export function treeViewNavigationAction<
  V extends AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  treeView: V,
  command: C
): Layer.Layer<
  never,
  never,
  ExtHost.ExtHost | UnknownTreeView<Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.effectDiscard(
    Effect.flatMap(ExtHost.ExtHost, (_) => _.registerTreeViewNavigationAction(treeView, command))
  )
}

export function treeViewTitleAction<
  V extends AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  treeView: V,
  command: C
): Layer.Layer<
  never,
  never,
  ExtHost.ExtHost | UnknownTreeView<Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
> {
  return Layer.effectDiscard(
    Effect.flatMap(ExtHost.ExtHost, (_) => _.registerTreeViewTitleAction(treeView, command))
  )
}

export function treeViewInlineAction<
  V extends AnyWithProps,
  C extends ExtCommand.AnyWithProps
>(
  treeView: V,
  _command: C
) {
  return <
    K extends Array<Keys<V, C>>
  >(
    ..._keys: K
  ): Layer.Layer<
    never,
    never,
    ExtHost.ExtHost | UnknownTreeView<Id<V>> | ExtCommand.UnknownCommand<ExtCommand.Id<C>>
  > =>
    Layer.effectDiscard(
      Effect.flatMap(ExtHost.ExtHost, (_) => _.registerTreeViewInlineAction(treeView, _command)(..._keys))
    )
}
