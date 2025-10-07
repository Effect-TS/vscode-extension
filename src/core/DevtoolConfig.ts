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
  in out Name extends string,
  out Type extends Schema.Schema.Any = typeof Schema.Void
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _name: Name
  readonly key: string
  readonly description: string
  readonly schema: Type
  readonly defaultValue: Schema.Schema.Type<Type>
  readonly annotations: Context_.Context<never>

  /**
   * Get the current value of the configuration.
   */
  readonly get: Effect.Effect<Schema.Schema.Type<Type>, never, DevtoolConfigProvider<Name>>

  /**
   * Get the changes of the configuration.
   */
  readonly changes: Effect.Effect<Schema.Schema.Type<Type>, never, DevtoolConfigProvider<Name>>

  /**
   * Set the schema for the configuration value.
   */
  setSchema<S extends Schema.Schema.Any>(schema: S, defaultValue: Schema.Schema.Type<S>): DevtoolConfig<Name, S>

  /**
   * Add an annotation on the configuration.
   */
  annotate<I, S>(tag: Context_.Tag<I, S>, value: S): DevtoolConfig<Name, Type>

  /**
   * Merge the annotations of the configuration with the provided context.
   */
  annotateContext<I>(context: Context_.Context<I>): DevtoolConfig<Name, Type>
}

/**
 * @since 1.0.0
 * @category models
 */
export interface Any extends Pipeable {
  readonly [TypeId]: TypeId
  readonly _name: string
  readonly key: string
}

/**
 * @since 1.0.0
 * @category models
 */
export interface AnyWithProps {
  readonly [TypeId]: TypeId
  readonly _name: string
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
export type Name<R> = R extends DevtoolConfig<infer _Name, infer _Type> ? _Name : never

/**
 * @since 1.0.0
 * @category models
 */
export type Type<R> = R extends DevtoolConfig<infer _Name, infer _Type> ? _Type["Type"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Encoded<R> = R extends DevtoolConfig<infer _Name, infer _Type> ? _Type["Encoded"] : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends DevtoolConfig<infer _Name, infer _Type> ? _Type["Context"] : never

export interface DevtoolConfigProvider<_Name extends string> {
  readonly _: unique symbol
  readonly name: _Name
}

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  setSchema(this: AnyWithProps, schema: Schema.Schema.Any, defaultValue: any) {
    return makeProto({
      _name: this._name,
      description: this.description,
      schema,
      defaultValue,
      annotations: this.annotations
    })
  },
  annotate(this: AnyWithProps, tag: Context_.Tag<any, any>, value: any) {
    return makeProto({
      _name: this._name,
      description: this.description,
      schema: this.schema,
      defaultValue: this.defaultValue,
      annotations: Context_.add(this.annotations, tag, value)
    })
  },
  annotateContext(this: AnyWithProps, context: Context_.Context<any>) {
    return makeProto({
      _name: this._name,
      description: this.description,
      schema: this.schema,
      defaultValue: this.defaultValue,
      annotations: Context_.merge(this.annotations, context)
    })
  }
}

const makeProto = <const Name extends string, Type extends Schema.Schema.Any>(options: {
  readonly _name: Name
  readonly description: string
  readonly schema: Type
  readonly defaultValue: Schema.Schema.Type<Type>
  readonly annotations: Context_.Context<never>
}): DevtoolConfig<Name, Type> => {
  function DevtoolConfig() {}
  Object.setPrototypeOf(DevtoolConfig, Proto)
  Object.assign(DevtoolConfig, options)
  DevtoolConfig.key = `@effect/devtools/DevtoolConfig/${options._name}`
  return DevtoolConfig as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <const Name extends string, Type extends Schema.Schema.Any = typeof Schema.Void>(
  name: Name,
  options: {
    readonly description?: string
    readonly schema?: Type
    readonly defaultValue?: Schema.Schema.Type<Type>
  }
): DevtoolConfig<Name, Type> => {
  const schema = options?.schema ?? Schema.Void
  const description = options?.description ?? name
  const defaultValue = options?.defaultValue ?? undefined

  return makeProto({
    _name: name,
    description,
    schema: schema as Type,
    defaultValue: defaultValue as Schema.Schema.Type<Type>,
    annotations: Context_.empty()
  }) as any
}
