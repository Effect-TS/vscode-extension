/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Option from "effect/Option"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import type * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type { DevtoolIcon } from "./DevtoolIcon"

export interface DevtoolTreeViewItem {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly icon: DevtoolIcon
}

export interface DevtoolTreeViewRefresh<Item extends Schema.Schema.Any> {
  (parent: Option.Option<Array<Schema.Schema.Type<Item>>>): Effect.Effect<void>
}

export interface DevtoolTreeViewBuilder<Item extends Schema.Schema.Any> {
  (refresh: DevtoolTreeViewRefresh<Item>): Effect.Effect<ReadonlyArray<Schema.Schema.Type<Item>>>
}

export interface DevtoolTreeViewDataProvider<Item extends Schema.Schema.Any> {
  treeItem: (element: Schema.Schema.Type<Item>) => Effect.Effect<DevtoolTreeViewItem>
  children: (
    parent: Option.Option<Array<Schema.Schema.Type<Item>>>
  ) => Effect.Effect<Option.Option<Array<Schema.Schema.Type<Item>>>>
}

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/DevtoolTreeView")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isDevtoolTreeView = (u: unknown): u is DevtoolTreeView<any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool tree view that can be displayed in a devtool application.
 *
 * @since 1.0.0
 * @category models
 */
export interface DevtoolTreeView<
  in out Id extends string,
  out Item extends Schema.Schema.Any = Schema.Schema.Any
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _id: Id
  readonly key: string
  readonly itemSchema: Item
  readonly annotations: Context_.Context<never>

  /**
   * Set the schema for the item type of the tree view.
   */
  setItemSchema<I extends Schema.Schema.Any>(schema: I): DevtoolTreeView<Id, I>

  /**
   * Add an annotation on the tree view.
   */
  annotate<I, S>(tag: Context_.Tag<I, S>, value: S): DevtoolTreeView<Id, Item>

  /**
   * Merge the annotations of the tree view with the provided context.
   */
  annotateContext<I>(context: Context_.Context<I>): DevtoolTreeView<Id, Item>

  /**
   * Converts the tree view into an Effect Context containing the provider.
   */
  toContext<EX = never, RX = never>(
    build: Effect.Effect<
      DevtoolTreeViewBuilder<Item>,
      EX,
      RX
    >
  ): Effect.Effect<Context_.Context<DevtoolTreeViewProvider<Id>>, EX, RX>

  /**
   * Converts the tree view into a Layer containing the provider.
   */
  toLayer<EX = never, RX = never>(
    build: Effect.Effect<
      DevtoolTreeViewBuilder<Item>,
      EX,
      RX
    >
  ): Layer.Layer<DevtoolTreeViewProvider<Id>, EX, Exclude<RX, Scope.Scope>>
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
  readonly key: string
  readonly itemSchema: Schema.Schema.Any
  readonly annotations: Context_.Context<never>
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends DevtoolTreeView<infer _Id, infer _Item> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Item<R> = R extends DevtoolTreeView<infer _Id, infer _Item> ? _Item["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type ItemEncoded<R> = R extends DevtoolTreeView<infer _Id, infer _Item> ? _Item["Encoded"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends DevtoolTreeView<infer _Id, infer _Item> ? _Item["Context"]
  : never

/**
 * Provider interface for tree view data
 *
 * @since 1.0.0
 * @category models
 */
export interface DevtoolTreeViewProvider<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
  readonly builder: DevtoolTreeViewBuilder<any>
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  setItemSchema(this: AnyWithProps, itemSchema: Schema.Schema.Any) {
    return makeProto({
      _id: this._id,
      itemSchema,
      annotations: this.annotations
    })
  },
  annotate(this: AnyWithProps, tag: Context_.Tag<any, any>, value: any) {
    return makeProto({
      _id: this._id,
      itemSchema: this.itemSchema,
      annotations: Context_.add(this.annotations, tag, value)
    })
  },
  annotateContext(this: AnyWithProps, context: Context_.Context<any>) {
    return makeProto({
      _id: this._id,
      itemSchema: this.itemSchema,
      annotations: Context_.merge(this.annotations, context)
    })
  },
  toContext(
    this: AnyWithProps,
    build: Effect.Effect<(parent: Option.Option<any>) => Effect.Effect<ReadonlyArray<any>>>
  ) {
    return Effect.gen(this, function*() {
      const context = yield* Effect.context<never>()
      const getItems = Effect.isEffect(build) ? yield* build : build
      const contextMap = new Map<string, unknown>()
      contextMap.set(this.key, { getItems, context })
      return Context_.unsafeMake(contextMap)
    })
  },
  toLayer(
    this: any,
    build: Effect.Effect<(parent: Option.Option<any>) => Effect.Effect<ReadonlyArray<any>>>
  ) {
    const tag = Context_.GenericTag<any>(this.key)
    return Layer.effect(
      tag,
      Proto.toContext.call(this, build).pipe(Effect.map((ctx) => Context_.unsafeGet(ctx, tag)))
    )
  }
}

const makeProto = <
  const Id extends string,
  Item extends Schema.Schema.Any
>(options: {
  readonly _id: Id
  readonly itemSchema: Item
  readonly annotations: Context_.Context<never>
}): DevtoolTreeView<Id, Item> => {
  function DevtoolTreeView() {}
  Object.setPrototypeOf(DevtoolTreeView, Proto)
  Object.assign(DevtoolTreeView, options)
  DevtoolTreeView.key = `@effect/devtools/DevtoolTreeView/${options._id}`
  return DevtoolTreeView as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <
  const Id extends string,
  Item extends Schema.Schema.Any = Schema.Schema.Any
>(
  id: Id,
  options?: {
    readonly itemSchema?: Item
  }
): DevtoolTreeView<Id, Item> => {
  const itemSchema = options?.itemSchema ?? ({} as Item)

  return makeProto({
    _id: id,
    itemSchema,
    annotations: Context_.empty()
  }) as any
}
