/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import type * as Effect from "effect/Effect"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/DevtoolConfig")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isDevtoolConfig = (u: unknown): u is DevtoolConfig<any, any> => Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool configuration value.
 *
 * @since 1.0.0
 * @category models
 */
export interface DevtoolConfig<
  in out Id extends string,
  out Type extends Schema.Schema.Any = typeof Schema.Void
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _id: Id
  readonly key: string
  readonly description: string
  readonly schema: Type
  readonly defaultValue: Schema.Schema.Type<Type>
  readonly annotations: Context_.Context<never>

  /**
   * Get the current value of the configuration.
   */
  readonly get: Effect.Effect<Schema.Schema.Type<Type>, never, DevtoolConfigProvider<Id>>

  /**
   * Get the changes of the configuration.
   */
  readonly changes: Effect.Effect<Schema.Schema.Type<Type>, never, DevtoolConfigProvider<Id>>

  /**
   * Set the schema for the configuration value.
   */
  setSchema<S extends Schema.Schema.Any>(schema: S, defaultValue: Schema.Schema.Type<S>): DevtoolConfig<Id, S>

  /**
   * Add an annotation on the configuration.
   */
  annotate<I, S>(tag: Context_.Tag<I, S>, value: S): DevtoolConfig<Id, Type>

  /**
   * Merge the annotations of the configuration with the provided context.
   */
  annotateContext<I>(context: Context_.Context<I>): DevtoolConfig<Id, Type>
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
  readonly description: string
  readonly schema: Schema.Schema.Any
  readonly defaultValue: any
  readonly annotations: Context_.Context<never>
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends DevtoolConfig<infer _Id, infer _Type> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Type<R> = R extends DevtoolConfig<infer _Id, infer _Type> ? _Type["Type"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Encoded<R> = R extends DevtoolConfig<infer _Id, infer _Type> ? _Type["Encoded"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends DevtoolConfig<infer _Id, infer _Type> ? _Type["Context"] : never

export interface DevtoolConfigProvider<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  setSchema(this: AnyWithProps, schema: Schema.Schema.Any, defaultValue: any) {
    return makeProto({
      _id: this._id,
      description: this.description,
      schema,
      defaultValue,
      annotations: this.annotations
    })
  },
  annotate(this: AnyWithProps, tag: Context_.Tag<any, any>, value: any) {
    return makeProto({
      _id: this._id,
      description: this.description,
      schema: this.schema,
      defaultValue: this.defaultValue,
      annotations: Context_.add(this.annotations, tag, value)
    })
  },
  annotateContext(this: AnyWithProps, context: Context_.Context<any>) {
    return makeProto({
      _id: this._id,
      description: this.description,
      schema: this.schema,
      defaultValue: this.defaultValue,
      annotations: Context_.merge(this.annotations, context)
    })
  }
}

const makeProto = <const Id extends string, Type extends Schema.Schema.Any>(options: {
  readonly _id: Id
  readonly description: string
  readonly schema: Type
  readonly defaultValue: Schema.Schema.Type<Type>
  readonly annotations: Context_.Context<never>
}): DevtoolConfig<Id, Type> => {
  function DevtoolConfig() {}
  Object.setPrototypeOf(DevtoolConfig, Proto)
  Object.assign(DevtoolConfig, options)
  DevtoolConfig.key = `@effect/devtools/DevtoolConfig/${options._id}`
  return DevtoolConfig as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <const Id extends string, Type extends Schema.Schema.Any = typeof Schema.Void>(
  id: Id,
  options: {
    readonly description?: string
    readonly schema?: Type
    readonly defaultValue?: Schema.Schema.Type<Type>
  }
): DevtoolConfig<Id, Type> => {
  const schema = options?.schema ?? Schema.Void
  const description = options?.description ?? id
  const defaultValue = options?.defaultValue ?? undefined

  return makeProto({
    _id: id,
    description,
    schema: schema as Type,
    defaultValue: defaultValue as Schema.Schema.Type<Type>,
    annotations: Context_.empty()
  }) as any
}
