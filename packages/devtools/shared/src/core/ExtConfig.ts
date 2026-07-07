/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import * as Effectable from "effect/Effectable"
import * as Layer from "effect/Layer"
import { type Pipeable } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/ExtConfig")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isExtConfig = (u: unknown): u is ExtConfig<any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool configuration value.
 *
 * @since 1.0.0
 * @category models
 */
export class ExtConfig<
  in out Id extends string,
  out Type extends Schema.Schema.AnyNoContext = typeof Schema.Void
> extends Effectable.Class<
  ConfigRef<Schema.Schema.Type<Type>>,
  never,
  ExtConfigHostCapability | MissingConfig<Id> | Scope.Scope
> {
  readonly [TypeId]: TypeId = TypeId
  readonly schema: Type
  readonly _id: Id
  readonly title: string
  readonly description: string
  readonly defaultValue: Schema.Schema.Type<Type>

  constructor(
    _id: Id,
    title: string,
    description: string,
    schema: Type,
    defaultValue: Schema.Schema.Type<Type>
  ) {
    super()
    this._id = _id
    this.title = title
    this.description = description
    this.defaultValue = defaultValue
    this.schema = Schema.annotations(schema, { default: defaultValue, description, title }) as Type
  }

  commit() {
    return Effect.gen(this, function*() {
      const host = yield* ExtConfigHostCapability
      return yield* host.readConfig(this)
    })
  }

  toLayer(): Layer.Layer<MissingConfig<Id>, never, ExtConfigHostCapability> {
    return Layer.scopedDiscard(Effect.gen(this, function*() {
      const host = yield* ExtConfigHostCapability
      return yield* host.registerConfig(this)
    })) as any
  }
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
  readonly description: string
  readonly schema: Schema.Schema.AnyNoContext
  readonly defaultValue: any
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends ExtConfig<infer _Id, infer _Type> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Type<R> = R extends ExtConfig<infer _Id, infer _Type> ? _Type["Type"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Encoded<R> = R extends ExtConfig<infer _Id, infer _Type> ? _Type["Encoded"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends ExtConfig<infer _Id, infer _Type> ? _Type["Context"] : never

/**
 * @since 1.0.0
 * @category models
 */
export interface MissingConfig<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
}

/**
 * @since 1.0.0
 * @category models
 */
export interface ConfigRef<A> {
  readonly get: Effect.Effect<A>
  readonly changes: Stream.Stream<A>
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <const Id extends string, Type extends Schema.Schema.AnyNoContext = typeof Schema.Void>(
  id: Id,
  options: {
    readonly title?: string
    readonly description?: string
    readonly schema: Type
    readonly defaultValue: Schema.Schema.Type<Type>
  }
): ExtConfig<Id, Type> => {
  const schema = options.schema
  const title = options?.title ?? id
  const description = options?.description ?? id
  const defaultValue = options.defaultValue

  return new ExtConfig(
    id,
    title,
    description,
    schema,
    defaultValue
  )
}

export class ExtConfigHostCapability
  extends Context_.Tag("@effect/devtools-shared/core/ExtConfig/ExtConfigHostCapability")<ExtConfigHostCapability, {
    registerConfig(config: AnyWithProps): Effect.Effect<void, never, never>
    readConfig(confing: AnyWithProps): Effect.Effect<ConfigRef<any>, never, Scope.Scope>
  }>()
{}
