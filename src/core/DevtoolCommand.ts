/**
 * @since 1.0.0
 */
import * as Context_ from "effect/Context"
import * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import { type Pipeable, pipeArguments } from "effect/Pipeable"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import type { DevtoolIcon } from "./DevtoolIcon.js"

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("@effect/devtools/DevtoolCommand")

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId

/**
 * @since 1.0.0
 * @category guards
 */
export const isDevtoolCommand = (u: unknown): u is DevtoolCommand<any, any, any, any> =>
  Predicate.hasProperty(u, TypeId)

/**
 * Represents a devtool command that can be executed in a devtool application.
 *
 * @since 1.0.0
 * @category models
 */
export interface DevtoolCommand<
  in out Id extends string,
  out Payload extends AnySchema = typeof Schema.Void,
  out Success extends Schema.Schema.Any = typeof Schema.Void,
  out Error extends Schema.Schema.All = typeof Schema.Never
> extends Pipeable {
  new(_: never): {}

  readonly [TypeId]: TypeId
  readonly _id: Id
  readonly key: string
  readonly title: string
  readonly icon: DevtoolIcon | undefined
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
  readonly annotations: Context_.Context<never>

  execute(
    ...args: PayloadConstructor<this> extends void ? [] : [PayloadConstructor<this>]
  ): Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>, DevtoolCommandProvider<Id>>

  /**
   * Set the schema for the success response of the command.
   */
  setSuccess<S extends Schema.Schema.Any>(schema: S): DevtoolCommand<Id, Payload, S, Error>

  /**
   * Set the schema for the error response of the command.
   */
  setError<E extends Schema.Schema.All>(schema: E): DevtoolCommand<Id, Payload, Success, E>

  /**
   * Set the schema for the payload of the command.
   */
  setPayload<P extends Schema.Struct<any> | Schema.Struct.Fields>(
    schema: P
  ): DevtoolCommand<
    Id,
    P extends Schema.Struct<infer _> ? P : P extends Schema.Struct.Fields ? Schema.Struct<P> : never,
    Success,
    Error
  >

  /**
   * Add an annotation on the command.
   */
  annotate<I, S>(tag: Context_.Tag<I, S>, value: S): DevtoolCommand<Id, Payload, Success, Error>

  /**
   * Merge the annotations of the command with the provided context.
   */
  annotateContext<I>(context: Context_.Context<I>): DevtoolCommand<Id, Payload, Success, Error>

  /**
   * Converts a toolkit into an Effect Context containing handlers for each tool
   * in the toolkit.
   */
  toContext<EX = never, RX = never>(
    build: Effect.Effect<
      (args: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>>,
      EX,
      RX
    >
  ): Effect.Effect<Context_.Context<DevtoolCommandProvider<Id>>, EX, RX>

  /**
   * Converts a toolkit into a Layer containing handlers for each tool in the
   * toolkit.
   */
  toLayer<EX = never, RX = never>(
    build: Effect.Effect<
      (args: Schema.Schema.Type<Payload>) => Effect.Effect<Schema.Schema.Type<Success>, Schema.Schema.Type<Error>>,
      EX,
      RX
    >
  ): Layer.Layer<DevtoolCommandProvider<Id>, EX, Exclude<RX, Scope.Scope>>
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
  readonly title: string
  readonly icon: DevtoolIcon | undefined
  readonly payloadSchema: AnySchema
  readonly successSchema: Schema.Schema.Any
  readonly errorSchema: Schema.Schema.All
  readonly annotations: Context_.Context<never>
}

/**
 * @since 1.0.0
 * @category models
 */
export type Id<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ? _Id : never

/**
 * @since 1.0.0
 * @category models
 */
export type Success<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ?
  _Success["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type SuccessEncoded<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ?
  _Success["Encoded"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type ErrorSchema<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ? _Error
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Error<R> = Schema.Schema.Type<ErrorSchema<R>>

/**
 * @since 1.0.0
 * @category models
 */
export type ErrorEncoded<R> = Schema.Schema.Encoded<ErrorSchema<R>>

/**
 * @since 1.0.0
 * @category models
 */
export type PayloadConstructor<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ?
  _Payload extends { readonly fields: Schema.Struct.Fields } ?
    Schema.Simplify<Schema.Struct.Constructor<_Payload["fields"]>>
  : _Payload["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Payload<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ?
  _Payload["Type"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Context<R> = R extends DevtoolCommand<infer _Id, infer _Payload, infer _Success, infer _Error> ?
  _Payload["Context"] | _Success["Context"] | _Error["Context"]
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type AddError<R extends Any, Error extends Schema.Schema.All> = R extends DevtoolCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error
> ? DevtoolCommand<_Id, _Payload, _Success, _Error | Error>
  : never

/**
 * @since 1.0.0
 * @category models
 */
export type Handler<_Id extends string> = (payload: any) => Effect.Effect<any, any, any>

/**
 * @since 1.0.0
 * @category models
 */
export type ToHandler<R extends Any> = R extends DevtoolCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error
> ? Handler<_Id>
  : never

export interface DevtoolCommandProvider<_Id extends string> {
  readonly _: unique symbol
  readonly id: _Id
}

/**
 * @since 1.0.0
 * @category models
 */
export type ToHandlerFn<Current extends Any, R = any> = (payload: Payload<Current>) => ResultFrom<Current, R>

/**
 * @since 1.0.0
 * @category models
 */
export type ResultFrom<R extends Any, Context> = R extends DevtoolCommand<
  infer _Id,
  infer _Payload,
  infer _Success,
  infer _Error
> ? Effect.Effect<_Success["Type"], _Error["Type"], Context>
  : never

const Proto = {
  [TypeId]: TypeId,
  pipe() {
    return pipeArguments(this, arguments)
  },
  setSuccess(this: AnyWithProps, successSchema: Schema.Schema.Any) {
    return makeProto({
      _id: this._id,
      title: this.title,
      icon: this.icon,
      payloadSchema: this.payloadSchema,
      successSchema,
      errorSchema: this.errorSchema,
      annotations: this.annotations
    })
  },
  setError(this: AnyWithProps, errorSchema: Schema.Schema.All) {
    return makeProto({
      _id: this._id,
      title: this.title,
      icon: this.icon,
      payloadSchema: this.payloadSchema,
      successSchema: this.successSchema,
      errorSchema,
      annotations: this.annotations
    })
  },
  setPayload(this: AnyWithProps, payloadSchema: Schema.Struct<any> | Schema.Struct.Fields) {
    return makeProto({
      _id: this._id,
      title: this.title,
      icon: this.icon,
      payloadSchema: Schema.isSchema(payloadSchema) ? payloadSchema as any : Schema.Struct(payloadSchema as any),
      successSchema: this.successSchema,
      errorSchema: this.errorSchema,
      annotations: this.annotations
    })
  },
  annotate(this: AnyWithProps, tag: Context_.Tag<any, any>, value: any) {
    return makeProto({
      _id: this._id,
      title: this.title,
      icon: this.icon,
      payloadSchema: this.payloadSchema,
      successSchema: this.successSchema,
      errorSchema: this.errorSchema,
      annotations: Context_.add(this.annotations, tag, value)
    })
  },
  annotateContext(this: AnyWithProps, context: Context_.Context<any>) {
    return makeProto({
      _id: this._id,
      title: this.title,
      icon: this.icon,
      payloadSchema: this.payloadSchema,
      successSchema: this.successSchema,
      errorSchema: this.errorSchema,
      annotations: Context_.merge(this.annotations, context)
    })
  },
  toContext(
    this: AnyWithProps,
    build: Effect.Effect<Handler<string>>
  ) {
    return Effect.gen(this, function*() {
      const context = yield* Effect.context<never>()
      const handler = Effect.isEffect(build) ? yield* build : build
      const contextMap = new Map<string, unknown>()
      contextMap.set(this.key, { handler, context })
      return Context_.unsafeMake(contextMap)
    })
  }
}

const makeProto = <
  const Id extends string,
  Payload extends Schema.Schema.Any,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All
>(options: {
  readonly _id: Id
  readonly title: string
  readonly icon: DevtoolIcon | undefined
  readonly payloadSchema: Payload
  readonly successSchema: Success
  readonly errorSchema: Error
  readonly annotations: Context_.Context<never>
}): DevtoolCommand<Id, Payload, Success, Error> => {
  function DevtoolCommand() {}
  Object.setPrototypeOf(DevtoolCommand, Proto)
  Object.assign(DevtoolCommand, options)
  DevtoolCommand.key = `@effect/devtools/DevtoolCommand/${options._id}`
  return DevtoolCommand as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <
  const Id extends string,
  Payload extends Schema.Schema.Any | Schema.Struct.Fields = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never
>(
  id: Id,
  options?: {
    readonly title?: string
    readonly icon?: DevtoolIcon
    readonly payload?: Payload
    readonly success?: Success
    readonly error?: Error
  }
): DevtoolCommand<
  Id,
  Payload extends Schema.Struct.Fields ? Schema.Struct<Payload> : Payload,
  Success,
  Error
> => {
  const successSchema = options?.success ?? Schema.Void
  const errorSchema = options?.error ?? Schema.Never
  const payloadSchema: any = Schema.isSchema(options?.payload) ?
    options?.payload as any
    : options?.payload ?
    Schema.Struct(options?.payload as any)
    : Schema.Void

  return makeProto({
    _id: id,
    title: options?.title ?? id,
    icon: options?.icon,
    payloadSchema,
    successSchema,
    errorSchema,
    annotations: Context_.empty()
  }) as any
}

/**
 * @since 1.0.0
 * @category constructors
 */
export interface AnySchema extends Pipeable {
  readonly [Schema.TypeId]: any
  readonly Type: any
  readonly Encoded: any
  readonly Context: any
  readonly make?: (params: any, ...rest: ReadonlyArray<any>) => any
  readonly ast: any
  readonly annotations: any
}
